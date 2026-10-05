import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { Confidence, Derivation } from "@/lib/ideology/derive";

// Everything here only changes after an ingestion run, which calls
// /api/revalidate (tag "atlas"). The hourly revalidate is a safety net.
const CACHE = { tags: ["atlas"], revalidate: 3600 };

export type Position = { v: number | null; c: Confidence | null; est: boolean };
export type MapCountry = {
  code: string;
  iso2: string | null;
  name: string;
  region: string | null;
  regime: string | null;
  disputed: boolean;
  sovereign: boolean;
  chief: string | null;
  econ: Position | null;
  galtan: Position | null;
  nobel: number;
};

type Row = Record<string, unknown>;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

export const getMapData = unstable_cache(
  async (): Promise<MapCountry[]> => {
    const r = await rows<{
      code: string;
      iso2: string | null;
      name: string;
      region: string | null;
      regime: string | null;
      disputed: boolean;
      ne_type: string;
      chief: string | null;
      econ_v: string | null;
      econ_c: Confidence | null;
      econ_e: boolean | null;
      gal_v: string | null;
      gal_c: Confidence | null;
      gal_e: boolean | null;
      has_gov: boolean;
      nobel: number;
    }>(sql`
      select c.code, c.iso2, c.name_pt as name, c.subregion as region, c.regime_type as regime,
             c.is_disputed as disputed, c.ne_type,
             p.name as chief, (g.id is not null) as has_gov,
             e.value_norm as econ_v, e.confidence as econ_c, e.is_estimate as econ_e,
             t.value_norm as gal_v, t.confidence as gal_c, t.is_estimate as gal_e,
             coalesce(n.cnt, 0)::int as nobel
      from countries c
      left join governments g on g.country_code = c.code and g.ended_on is null
      left join people p on p.id = case when g.chief_executive_role = 'head_of_state' then g.head_of_state_id else g.head_of_government_id end
      left join government_positions e on e.government_id = g.id and e.dimension = 'econ_lr'
      left join government_positions t on t.government_id = g.id and t.dimension = 'galtan'
      left join (
        select country_code, count(distinct laureate_id) cnt
        from nobel_laureate_countries where relation in ('birth', 'org_seat') group by country_code
      ) n on n.country_code = c.code
      order by c.name_pt`);
    const pos = (v: string | null, c: Confidence | null, e: boolean | null, has: boolean): Position | null =>
      has ? { v: v == null ? null : Number(v), c, est: !!e } : null;
    return r.map((x) => ({
      code: x.code.trim(),
      iso2: x.iso2,
      name: x.name,
      region: x.region,
      regime: x.regime,
      disputed: x.disputed,
      sovereign: /Sovereign|Country/.test(x.ne_type),
      chief: x.chief,
      econ: pos(x.econ_v, x.econ_c, x.econ_e, x.has_gov),
      galtan: pos(x.gal_v, x.gal_c, x.gal_e, x.has_gov),
      nobel: x.nobel,
    }));
  },
  ["map-data"],
  CACHE,
);

export type Stats = { countries: number; classified: number; laureates: number; prizes: number; updatedAt: string | null };
export const getStats = unstable_cache(
  async (): Promise<Stats> => {
    const [r] = await rows<{ countries: number; classified: number; laureates: number; prizes: number; updated_at: string | null }>(sql`
      select (select count(*) from governments where ended_on is null)::int as countries,
             (select count(*) from government_positions gp join governments g on g.id = gp.government_id
               where g.ended_on is null and gp.dimension = 'econ_lr' and gp.value_norm is not null)::int as classified,
             (select count(*) from nobel_laureates)::int as laureates,
             (select count(*) from nobel_prizes)::int as prizes,
             (select max(finished_at) from ingest_runs where status = 'ok') as updated_at`);
    return { countries: r.countries, classified: r.classified, laureates: r.laureates, prizes: r.prizes, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null };
  },
  ["stats"],
  CACHE,
);

export type FeedEvent = { id: number; type: string; country: string | null; countryName: string | null; at: string; title: string; url: string | null };
export const getEvents = unstable_cache(
  async (limit = 30): Promise<FeedEvent[]> => {
    const r = await rows<{ id: number; type: string; country_code: string | null; name: string | null; occurred_at: string; title: string; source_url: string | null }>(sql`
      select e.id, e.type, e.country_code, c.name_pt as name, e.occurred_at, e.title, e.source_url
      from events e left join countries c on c.code = e.country_code
      order by e.occurred_at desc, e.id desc limit ${limit}`);
    return r.map((e) => ({ id: e.id, type: e.type, country: e.country_code?.trim() ?? null, countryName: e.name, at: new Date(e.occurred_at).toISOString(), title: e.title, url: e.source_url }));
  },
  ["events"],
  CACHE,
);

export type Source = { id: string; name: string; publisher: string | null; url: string; license: string | null; citation: string | null; version: string | null; retrievedAt: string | null };
export const getSources = unstable_cache(
  async (): Promise<Source[]> => {
    const r = await rows<Source & { retrieved_at: string | null }>(sql`select id, name, publisher, url, license, citation, version, retrieved_at from sources order by name`);
    return r.map((s) => ({ ...s, retrievedAt: s.retrieved_at ? new Date(s.retrieved_at).toISOString() : null }));
  },
  ["sources"],
  CACHE,
);

// ── Dossier ─────────────────────────────────────────────────────

export type DossierPerson = { name: string; qid: string | null };
export type DossierParty = { name: string; abbrev: string | null; qid: string | null; role: string; partyfactsId: number | null };
export type DossierPosition = { dimension: "econ_lr" | "galtan"; v: number | null; c: Confidence | null; est: boolean; derivation: Derivation & { chiefExecutiveRule?: string }; computedAt: string };
export type NobelEntry = { laureateId: number; name: string; kind: string; year: number; category: string; motivation: string | null; relation: string; affiliation: string | null; url: string };
export type Dossier = {
  code: string;
  iso2: string | null;
  name: string;
  nameEn: string;
  region: string | null;
  regime: string | null;
  regimeYear: number | null;
  disputed: boolean;
  disputeNote: string | null;
  sovereignCode: string | null;
  population: number | null;
  countryQid: string | null;
  updatedAt: string;
  government: null | {
    hos: DossierPerson | null;
    hog: DossierPerson | null;
    chiefRole: "head_of_state" | "head_of_government";
    chiefRule: string;
    startedOn: string | null;
    nextElection: null | { date: string; name: string | null; confirmed: boolean | null; url: string | null; daysUntil: number };
    verifiedAt: string | null;
    sourceId: string | null;
    sourceUrl: string | null;
    parties: DossierParty[];
    positions: DossierPosition[];
  };
  nobel: NobelEntry[];
  sourceIds: string[];
};

export const getDossier = unstable_cache(
  async (code: string): Promise<Dossier | null> => {
    const [c] = await rows<Row>(sql`select * from countries where code = ${code}`);
    if (!c) return null;
    const [g] = await rows<Row>(sql`
      select g.*, hs.name as hos_name, hs.wikidata_qid as hos_qid, hg.name as hog_name, hg.wikidata_qid as hog_qid
      from governments g
      left join people hs on hs.id = g.head_of_state_id
      left join people hg on hg.id = g.head_of_government_id
      where g.country_code = ${code} and g.ended_on is null`);
    const sourceIds = new Set<string>(["natural-earth"]);
    if (c.regime_source_id) sourceIds.add(String(c.regime_source_id));

    let government: Dossier["government"] = null;
    if (g) {
      const parties = await rows<{ name: string; abbrev: string | null; wikidata_qid: string | null; role: string; partyfacts_id: number | null }>(sql`
        select p.name, p.abbrev, p.wikidata_qid, gp.role, p.partyfacts_id
        from government_parties gp join parties p on p.id = gp.party_id
        where gp.government_id = ${g.id} order by gp.role, p.name`);
      const positions = await rows<{ dimension: "econ_lr" | "galtan"; value_norm: string | null; confidence: Confidence | null; is_estimate: boolean; derivation: DossierPosition["derivation"]; computed_at: string }>(sql`
        select dimension, value_norm, confidence, is_estimate, derivation, computed_at
        from government_positions where government_id = ${g.id} order by dimension`);
      for (const p of positions) {
        const ch = p.derivation.chosen;
        if (ch?.sourceId) sourceIds.add(ch.sourceId);
        for (const a of p.derivation.alternatives) sourceIds.add(a.sourceId);
      }
      sourceIds.add(String(g.source_id ?? "wikidata"));
      sourceIds.add("wikidata");
      if (parties.some((p) => p.partyfacts_id)) sourceIds.add("partyfacts");
      if (g.next_election_on) sourceIds.add("electionguide");
      government = {
        hos: g.hos_name ? { name: String(g.hos_name), qid: (g.hos_qid as string) ?? null } : null,
        hog: g.hog_name ? { name: String(g.hog_name), qid: (g.hog_qid as string) ?? null } : null,
        chiefRole: g.chief_executive_role as "head_of_state" | "head_of_government",
        chiefRule: String(g.chief_executive_rule),
        startedOn: g.started_on ? String(g.started_on).slice(0, 10) : null,
        nextElection: g.next_election_on
          ? {
              date: new Date(g.next_election_on as string).toISOString().slice(0, 10),
              name: (g.next_election_name as string) ?? null,
              confirmed: (g.next_election_confirmed as boolean) ?? null,
              url: (g.next_election_source_url as string) ?? null,
              // Cached for at most an hour, so this can be off by one around midnight.
              daysUntil: Math.ceil((new Date(g.next_election_on as string).getTime() - Date.now()) / 864e5),
            }
          : null,
        verifiedAt: g.verified_at ? new Date(g.verified_at as string).toISOString() : null,
        sourceId: (g.source_id as string) ?? null,
        sourceUrl: (g.source_url as string) ?? null,
        parties: parties.map((p) => ({ name: p.name, abbrev: p.abbrev, qid: p.wikidata_qid, role: p.role, partyfactsId: p.partyfacts_id })),
        positions: positions.map((p) => ({
          dimension: p.dimension,
          v: p.value_norm == null ? null : Number(p.value_norm),
          c: p.confidence,
          est: p.is_estimate,
          derivation: p.derivation,
          computedAt: new Date(p.computed_at).toISOString(),
        })),
      };
    }

    const nobel = await rows<{ laureate_id: number; name: string; kind: string; year: number; category: string; motivation: string | null; relation: string; affiliation: string | null; source_url: string }>(sql`
      select distinct l.id as laureate_id, l.name, l.kind, p.year, p.category, p.motivation, lc.relation, p.affiliation, l.source_url
      from nobel_laureate_countries lc
      join nobel_laureates l on l.id = lc.laureate_id
      join nobel_prizes p on p.laureate_id = l.id and (lc.prize_id is null or lc.prize_id = p.id)
      where lc.country_code = ${code}
      order by p.year desc, l.name`);
    if (nobel.length) sourceIds.add("nobel-api");

    return {
      code: String(c.code).trim(),
      iso2: (c.iso2 as string) ?? null,
      name: String(c.name_pt),
      nameEn: String(c.name_en),
      region: (c.subregion as string) ?? null,
      regime: (c.regime_type as string) ?? null,
      regimeYear: (c.regime_year as number) ?? null,
      disputed: !!c.is_disputed,
      disputeNote: (c.dispute_note as string) ?? null,
      sovereignCode: c.sovereign_code ? String(c.sovereign_code).trim() : null,
      population: c.population ? Number(c.population) : null,
      countryQid: (c.wikidata_qid as string) ?? null,
      updatedAt: new Date(c.updated_at as string).toISOString(),
      government,
      nobel: nobel.map((n) => ({ laureateId: n.laureate_id, name: n.name, kind: n.kind, year: n.year, category: n.category, motivation: n.motivation, relation: n.relation, affiliation: n.affiliation, url: n.source_url })),
      sourceIds: [...sourceIds],
    };
  },
  ["dossier"],
  CACHE,
);

export const getCountryCodes = unstable_cache(
  async () => (await rows<{ code: string }>(sql`select code from countries`)).map((r) => r.code.trim()),
  ["codes"],
  CACHE,
);
