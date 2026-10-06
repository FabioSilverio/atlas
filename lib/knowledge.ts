import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

// Read models for thinkers, ideologies and elections (Phases 2–3).
const CACHE = { tags: ["atlas"], revalidate: 3600 };
const rows = async <T,>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const num = (v: unknown) => (v == null ? null : Number(v));

export type Ref = { qid: string; label: string };
export type ThinkerCard = {
  qid: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  birthYear: number | null;
  deathYear: number | null;
  fields: Ref[];
  occupations: Ref[];
  sitelinks: number;
  country: string | null;
  theses: string[] | null;
};

const CARD = sql`p.wikidata_qid as qid, p.name, t.description, p.image_url, t.birth_year, t.death_year, t.fields, t.occupations, t.sitelinks, t.primary_country, t.theses`;
type CardRow = { qid: string; name: string; description: string | null; image_url: string | null; birth_year: number | null; death_year: number | null; fields: Ref[]; occupations: Ref[]; sitelinks: number; primary_country: string | null; theses: string[] | null };
const card = (r: CardRow): ThinkerCard => ({
  qid: r.qid,
  name: r.name,
  description: r.description,
  imageUrl: r.image_url,
  birthYear: r.birth_year,
  deathYear: r.death_year,
  fields: r.fields ?? [],
  occupations: r.occupations ?? [],
  sitelinks: r.sitelinks,
  country: r.primary_country?.trim() ?? null,
  theses: r.theses ?? null,
});

export const getCountryThinkers = unstable_cache(
  async (code: string, limit = 12) => {
    const list = await rows<CardRow>(sql`
      select ${CARD} from thinkers t join people p on p.id = t.person_id
      where t.primary_country = ${code} order by t.sitelinks desc limit ${limit}`);
    const [{ n }] = await rows<{ n: number }>(sql`select count(*)::int n from thinkers where primary_country = ${code}`);
    // Foreign thinkers who influenced this country's thinkers (Wikidata P737), most-cited first.
    const foreign = await rows<CardRow & { cites: number }>(sql`
      select ${CARD}, count(*)::int as cites
      from thinker_influences i
      join thinkers mine on mine.person_id = i.influenced_id and mine.primary_country = ${code}
      join thinkers t on t.person_id = i.influencer_id and coalesce(t.primary_country, '') <> ${code}
      join people p on p.id = t.person_id
      group by p.wikidata_qid, p.name, t.description, p.image_url, t.birth_year, t.death_year, t.fields, t.occupations, t.sitelinks, t.primary_country, t.theses
      order by cites desc, t.sitelinks desc limit 10`);
    return { total: n, thinkers: list.map(card), foreign: foreign.map((f) => ({ ...card(f), cites: f.cites })) };
  },
  ["country-thinkers"],
  CACHE,
);

/** Country → country influence flows (for map arcs): influencer country → influenced country. */
export const getInfluenceFlows = unstable_cache(
  async (code: string) =>
    (
      await rows<{ src: string; dst: string; n: number }>(sql`
      select a.primary_country as src, b.primary_country as dst, count(*)::int as n
      from thinker_influences i
      join thinkers a on a.person_id = i.influencer_id
      join thinkers b on b.person_id = i.influenced_id
      where (a.primary_country = ${code} or b.primary_country = ${code}) and a.primary_country <> b.primary_country
      group by 1, 2 order by n desc limit 40`)
    ).map((r) => ({ src: r.src.trim(), dst: r.dst.trim(), n: r.n })),
  ["influence-flows"],
  CACHE,
);

export type ThinkerPage = ThinkerCard & {
  concepts: string[];
  thesesSource: string | null;
  thesesAt: string | null;
  thesesModel: string | null;
  summary: string | null;
  summaryUrl: string | null;
  imageLicense: string | null;
  imageAttribution: string | null;
  movements: Ref[];
  notableWorks: Ref[];
  awards: Ref[];
  countries: { code: string; name: string; relation: string }[];
  influencedBy: ThinkerCard[];
  influenced: ThinkerCard[];
  ideologies: { qid: string; name: string; relation: string }[];
  nobel: { year: number; category: string }[];
  mentions: { country: string; name: string; n: number }[];
  updatedAt: string;
};

export const getThinker = unstable_cache(
  async (qid: string): Promise<ThinkerPage | null> => {
    const [r] = await rows<CardRow & { summary: string | null; summary_url: string | null; image_license: string | null; image_attribution: string | null; movements: Ref[]; notable_works: Ref[]; awards: Ref[]; person_id: number; updated_at: string; concepts: string[] | null; theses_source: string | null; theses_at: string | null; theses_model: string | null }>(sql`
      select ${CARD}, t.summary, t.summary_url, p.image_license, p.image_attribution, t.movements, t.notable_works, t.awards, t.person_id, t.updated_at,
        t.concepts, t.theses_source, t.theses_at, t.theses_model
      from thinkers t join people p on p.id = t.person_id where p.wikidata_qid = ${qid}`);
    if (!r) return null;
    const [countries, by, of, ideologies, nobel, mentions] = await Promise.all([
      rows<{ code: string; name: string; relation: string }>(sql`select tc.country_code as code, c.name_pt as name, tc.relation from thinker_countries tc join countries c on c.code = tc.country_code where tc.person_id = ${r.person_id}`),
      rows<CardRow>(sql`select ${CARD} from thinker_influences i join thinkers t on t.person_id = i.influencer_id join people p on p.id = t.person_id where i.influenced_id = ${r.person_id} order by t.sitelinks desc limit 24`),
      rows<CardRow>(sql`select ${CARD} from thinker_influences i join thinkers t on t.person_id = i.influenced_id join people p on p.id = t.person_id where i.influencer_id = ${r.person_id} order by t.sitelinks desc limit 24`),
      rows<{ qid: string; name: string; relation: string }>(sql`select i.qid, i.name, ti.relation from thinker_ideologies ti join ideologies i on i.qid = ti.ideology_qid where ti.person_id = ${r.person_id}`),
      rows<{ year: number; category: string }>(sql`select np.year, np.category from nobel_laureates l join nobel_prizes np on np.laureate_id = l.id where l.person_id = ${r.person_id}`),
      // Where the name shows up in the opinion pieces we track (Phase 4).
      rows<{ country: string; name: string; n: number }>(sql`
        select a.country_code as country, c.name_pt as name, count(*)::int n
        from articles a join countries c on c.code = a.country_code
        where a.title ilike ${"%" + r.name.split(" ").slice(-1)[0] + "%"} and length(${r.name.split(" ").slice(-1)[0]}) >= 4
        group by 1, 2 order by n desc limit 15`),
    ]);
    return {
      ...card(r),
      concepts: r.concepts ?? [],
      thesesSource: r.theses_source,
      thesesAt: r.theses_at ? new Date(r.theses_at).toISOString() : null,
      thesesModel: r.theses_model,
      summary: r.summary,
      summaryUrl: r.summary_url,
      imageLicense: r.image_license,
      imageAttribution: r.image_attribution,
      movements: r.movements ?? [],
      notableWorks: r.notable_works ?? [],
      awards: r.awards ?? [],
      countries: countries.map((c) => ({ ...c, code: c.code.trim() })),
      influencedBy: by.map(card),
      influenced: of.map(card),
      ideologies,
      nobel,
      mentions: mentions.map((m) => ({ ...m, country: m.country.trim() })),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  },
  ["thinker"],
  CACHE,
);

export const getTopThinkers = unstable_cache(
  async (limit = 60) => (await rows<CardRow>(sql`select ${CARD} from thinkers t join people p on p.id = t.person_id order by t.sitelinks desc limit ${limit}`)).map(card),
  ["top-thinkers"],
  CACHE,
);

// ── Ideologies ─────────────────────────────────────────────────

export type IdeologyListItem = { qid: string; name: string; description: string | null; inPower: number; parties: number; thinkers: number };
export const getIdeologies = unstable_cache(
  async (): Promise<IdeologyListItem[]> =>
    rows<IdeologyListItem>(sql`
      select i.qid, i.name, i.description,
        (select count(distinct g.country_code)::int from party_ideologies pi
           join government_parties gp on gp.party_id = pi.party_id and gp.role = 'leader'
           join governments g on g.id = gp.government_id and g.ended_on is null
         where pi.ideology_qid = i.qid) as "inPower",
        (select count(*)::int from party_ideologies pi where pi.ideology_qid = i.qid) as parties,
        (select count(*)::int from thinker_ideologies ti where ti.ideology_qid = i.qid) as thinkers
      from ideologies i
      where exists (select 1 from party_ideologies pi where pi.ideology_qid = i.qid)
         or exists (select 1 from thinker_ideologies ti where ti.ideology_qid = i.qid)
      order by "inPower" desc, thinkers desc, i.name`),
  ["ideologies"],
  CACHE,
);

export type IdeologyPage = {
  qid: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  summary: string | null;
  summaryUrl: string | null;
  inPower: { code: string; country: string; party: string; leader: string | null; econ: number | null }[];
  parties: { code: string; country: string; party: string; econ: number | null }[];
  thinkers: ThinkerCard[];
  timeline: { year: number; countries: number }[];
};

export const getIdeology = unstable_cache(
  async (qid: string): Promise<IdeologyPage | null> => {
    const [i] = await rows<{ qid: string; name: string; name_en: string | null; description: string | null; summary: string | null; summary_url: string | null }>(sql`select * from ideologies where qid = ${qid}`);
    if (!i) return null;
    const [inPower, parties, thinkers, timeline] = await Promise.all([
      rows<{ code: string; country: string; party: string; leader: string | null; econ: string | null }>(sql`
        select distinct on (g.country_code) g.country_code as code, c.name_pt as country, pa.name as party, pe.name as leader, gpos.value_norm as econ
        from party_ideologies pi
        join government_parties gp on gp.party_id = pi.party_id and gp.role = 'leader'
        join governments g on g.id = gp.government_id and g.ended_on is null
        join parties pa on pa.id = pi.party_id
        join countries c on c.code = g.country_code
        left join people pe on pe.id = case when g.chief_executive_role = 'head_of_state' then g.head_of_state_id else g.head_of_government_id end
        left join government_positions gpos on gpos.government_id = g.id and gpos.dimension = 'econ_lr'
        where pi.ideology_qid = ${qid} order by g.country_code`),
      rows<{ code: string; country: string; party: string; econ: string | null }>(sql`
        select pa.country_code as code, c.name_pt as country, pa.name as party,
          (select value_norm from ideology_scores s where s.party_id = pa.id and s.dimension = 'econ_lr' and s.method = 'expert_survey' limit 1) as econ
        from party_ideologies pi join parties pa on pa.id = pi.party_id left join countries c on c.code = pa.country_code
        where pi.ideology_qid = ${qid} order by c.name_pt`),
      rows<CardRow>(sql`select ${CARD} from thinker_ideologies ti join thinkers t on t.person_id = ti.person_id join people p on p.id = t.person_id where ti.ideology_qid = ${qid} order by t.sitelinks desc limit 30`),
      // Countries whose chief executive's party carried this ideology label, by year (2006→, via Herre's party ids).
      rows<{ year: number; countries: number }>(sql`
        select eh.year, count(distinct eh.country_code)::int as countries
        from executive_history eh
        join parties pa on pa.partyfacts_id = eh.partyfacts_id
        join party_ideologies pi on pi.party_id = pa.id and pi.ideology_qid = ${qid}
        group by eh.year order by eh.year`),
    ]);
    return {
      qid: i.qid,
      name: i.name,
      nameEn: i.name_en,
      description: i.description,
      summary: i.summary,
      summaryUrl: i.summary_url,
      inPower: inPower.map((r) => ({ ...r, code: r.code.trim(), econ: num(r.econ) })),
      parties: parties.map((r) => ({ ...r, code: r.code?.trim() ?? "", econ: num(r.econ) })),
      thinkers: thinkers.map(card),
      timeline,
    };
  },
  ["ideology"],
  CACHE,
);

// ── Elections ──────────────────────────────────────────────────

export type ElectionResultRow = { party: string; partyfactsId: number | null; candidate: string | null; seats: number | null; seatsBefore: number | null; share: number | null; econ: number | null; scoreSource: string | null };
export type ElectionItem = {
  id: number;
  date: string;
  kind: "presidential" | "legislative";
  body: string;
  title: string;
  status: string;
  totalSeats: number | null;
  turnout: number | null;
  econ: number | null;
  galtan: number | null;
  coverage: number | null;
  winner: string | null;
  url: string | null;
  drift: number | null;
  results: ElectionResultRow[];
};

export const getCountryElections = unstable_cache(
  async (code: string) => {
    const els = await rows<{ id: number; date: string; kind: "presidential" | "legislative"; body: string; title: string; status: string; total_seats: number | null; turnout: string | null; econ: string | null; galtan: string | null; coverage: string | null; winner: string | null; wikipedia_url: string | null }>(sql`
      select * from elections where country_code = ${code} order by date desc, kind`);
    const res = els.length
      ? await rows<{ election_id: number; party_label: string; partyfacts_id: number | null; candidate: string | null; seats: number | null; seats_before: number | null; vote_share: string | null; econ: string | null; score_source: string | null; position: number }>(sql`
          select election_id, party_label, partyfacts_id, candidate, seats, seats_before, vote_share, econ, score_source, position from election_results
          where election_id in (select id from elections where country_code = ${code}) order by election_id, coalesce(seats, -1) desc, coalesce(vote_share, -1) desc, position`)
      : [];
    const items: ElectionItem[] = els.map((e) => ({
      id: e.id,
      date: new Date(e.date).toISOString().slice(0, 10),
      kind: e.kind,
      body: e.body,
      title: e.title,
      status: e.status,
      totalSeats: e.total_seats,
      turnout: num(e.turnout),
      econ: num(e.econ),
      galtan: num(e.galtan),
      coverage: num(e.coverage),
      winner: e.winner,
      url: e.wikipedia_url,
      drift: null,
      results: res
        .filter((r) => r.election_id === e.id)
        .map((r) => ({ party: r.party_label, partyfactsId: r.partyfacts_id, candidate: r.candidate, seats: r.seats, seatsBefore: r.seats_before, share: num(r.vote_share), econ: num(r.econ), scoreSource: r.score_source })),
    }));
    // Drift: change against the previous election for the same body.
    for (const e of items) {
      const prev = items.find((p) => p.body === e.body && p.kind === e.kind && p.date < e.date);
      if (prev && e.econ != null && prev.econ != null) e.drift = e.econ - prev.econ;
    }
    const executive = await rows<{ year: number; leader: string | null; party: string | null; label: string | null; econ: string | null; source_id: string | null }>(sql`
      select * from executive_history where country_code = ${code} order by year`);
    return { elections: items, executive: executive.map((x) => ({ ...x, econ: num(x.econ) })) };
  },
  ["country-elections"],
  CACHE,
);

// ── Government in context ──────────────────────────────────────

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type GovContext = {
  country: string;
  leader: {
    name: string;
    qid: string | null;
    since: string | null;
    role: string;
    ideologies: Ref[];
    influencedBy: Ref[];
    description: string | null;
    summary: string | null;
    summaryUrl: string | null;
    imageUrl: string | null;
    birthYear: number | null;
    occupations: string[];
  } | null;
  party: {
    qid: string;
    name: string;
    founded: string | null;
    founders: string[];
    chair: string | null;
    alignment: string[];
    ideologies: Ref[];
    summary: string | null;
    summaryUrl: string | null;
  } | null;
  rise: { election: ElectionItem; opponent: ElectionResultRow | null; winnerRow: ElectionResultRow | null; matched: "candidate" | "legislative" } | null;
  latest: ElectionItem | null;
  strength: { seats: number; total: number; body: string; date: string; label: string } | null;
  affiliated: import("@/lib/db/schema").ContextPerson[];
  sharedIdeology: import("@/lib/db/schema").ContextPerson[];
  tradition: ThinkerCard[];
  updatedAt: string | null;
};

export const getGovernmentContext = unstable_cache(
  async (code: string): Promise<GovContext | null> => {
    const [g] = await rows<{ role: string; since: string | null; name: string | null; qid: string | null; party_name: string | null; party_qid: string | null; party_id: number | null; party_pf: number | null }>(sql`
      select g.chief_executive_role as role, g.started_on as since, pe.name, pe.wikidata_qid as qid,
        (select pa.name from government_parties x join parties pa on pa.id = x.party_id where x.government_id = g.id and x.role = 'leader' order by x.position limit 1) as party_name,
        (select pa.wikidata_qid from government_parties x join parties pa on pa.id = x.party_id where x.government_id = g.id and x.role = 'leader' order by x.position limit 1) as party_qid,
        (select pa.id from government_parties x join parties pa on pa.id = x.party_id where x.government_id = g.id and x.role = 'leader' order by x.position limit 1) as party_id,
        (select pa.partyfacts_id from government_parties x join parties pa on pa.id = x.party_id where x.government_id = g.id and x.role = 'leader' order by x.position limit 1) as party_pf
      from governments g
      left join people pe on pe.id = case when g.chief_executive_role = 'head_of_state' then g.head_of_state_id else g.head_of_government_id end
      where g.country_code = ${code} and g.ended_on is null`);
    if (!g) return null;
    const [ctx] = await rows<{ party: GovContext["party"]; leader: import("@/lib/db/schema").GovernmentLeader | null; affiliated: GovContext["affiliated"]; shared_ideology: GovContext["sharedIdeology"]; updated_at: string }>(sql`
      select party, leader, affiliated, shared_ideology, updated_at from government_context where country_code = ${code}`);
    const { elections } = await getCountryElections(code);

    // How they got there: the most recent election where the leader ran (top two), else the last legislative vote before taking office.
    const surname = g.name ? fold(g.name).split(" ").filter((w) => w.length >= 3).slice(-1)[0] : null;
    let rise: GovContext["rise"] = null;
    // Only elections up to the start of the mandate (plus a little slack for inaugurations).
    const sinceLimit = g.since ? new Date(new Date(g.since).getTime() + 7 * 864e5).toISOString().slice(0, 10) : null;
    for (const e of elections.filter((x) => !sinceLimit || x.date <= sinceLimit)) {
      const i = surname ? e.results.findIndex((r) => r.candidate && fold(r.candidate).includes(surname)) : -1;
      if (i >= 0 && i <= 1) {
        const others = e.results.filter((_, k) => k !== i);
        rise = { election: e, winnerRow: e.results[i], opponent: others[0] ?? null, matched: "candidate" };
        break;
      }
    }
    if (!rise && g.since) {
      const leg = elections.find((e) => e.kind === "legislative" && e.date <= g.since! && e.results.length);
      if (leg) {
        const mine = leg.results.find((r) => g.party_name && fold(r.party).includes(fold(g.party_name).split(" (")[0]));
        const rival = leg.results.find((r) => r !== mine);
        rise = { election: leg, winnerRow: mine ?? null, opponent: rival ?? null, matched: "legislative" };
      }
    }
    // Current strength: ruling party's share of seats in the latest legislative result.
    const lastLeg = elections.find((e) => e.kind === "legislative" && e.results.some((r) => r.seats != null));
    let strength: GovContext["strength"] = null;
    if (lastLeg && g.party_name) {
      const key = fold(g.party_name).split(" (")[0];
      // Party Facts id first (also covers federations/alliances mapped to the lead party), then the name.
      const mine =
        (g.party_pf ? lastLeg.results.find((r) => r.partyfactsId === g.party_pf) : undefined) ??
        lastLeg.results.find((r) => fold(r.party).includes(key) || key.includes(fold(r.party)));
      const total = lastLeg.totalSeats ?? lastLeg.results.reduce((a, r) => a + (r.seats ?? 0), 0);
      if (mine?.seats != null && total) strength = { seats: mine.seats, total, body: lastLeg.body, date: lastLeg.date, label: mine.party };
    }
    const ideologyQids = ctx?.party?.ideologies.map((i) => i.qid) ?? [];
    const tradition = ideologyQids.length
      ? (
          await rows<CardRow>(sql`
            select distinct on (t.sitelinks, p.wikidata_qid) ${CARD}
            from thinker_ideologies ti join thinkers t on t.person_id = ti.person_id join people p on p.id = t.person_id
            where ti.ideology_qid in (${sql.join(ideologyQids.map((q) => sql`${q}`), sql`, `)})
            order by t.sitelinks desc, p.wikidata_qid limit 10`)
        ).map(card)
      : [];
    return {
      country: code,
      leader: g.name
        ? {
            name: g.name,
            qid: g.qid,
            since: g.since ? new Date(g.since).toISOString().slice(0, 10) : null,
            role: g.role,
            ideologies: ctx?.leader?.ideologies ?? [],
            influencedBy: ctx?.leader?.influencedBy ?? [],
            description: ctx?.leader?.description ?? null,
            summary: ctx?.leader?.summary ?? null,
            summaryUrl: ctx?.leader?.summaryUrl ?? null,
            imageUrl: ctx?.leader?.imageUrl ?? null,
            birthYear: ctx?.leader?.birthYear ?? null,
            occupations: ctx?.leader?.occupations ?? [],
          }
        : null,
      party: ctx?.party ?? (g.party_name && g.party_qid ? { qid: g.party_qid, name: g.party_name, founded: null, founders: [], chair: null, alignment: [], ideologies: [], summary: null, summaryUrl: null } : null),
      rise,
      latest: elections[0] ?? null,
      strength,
      affiliated: ctx?.affiliated ?? [],
      sharedIdeology: ctx?.shared_ideology ?? [],
      tradition,
      updatedAt: ctx?.updated_at ? new Date(ctx.updated_at).toISOString() : null,
    };
  },
  ["gov-context"],
  CACHE,
);

// ── Opinion (Phase 4) ──────────────────────────────────────────

export type OpinionData = {
  outlets: { id: string; name: string; url: string; kind: string; alignment: string | null; articles: number }[];
  columnists: { name: string; outlet: string; articles: number }[];
  articles: { id: number; title: string; url: string; outlet: string; author: string | null; at: string; summary: string | null; theme: string | null }[];
  themes: { theme: string; recent: number; previous: number; trend: string }[];
  theses: { text: string; mentions: number; theme: string | null; lastSeen: string }[];
};

export const getCountryOpinion = unstable_cache(
  async (code: string): Promise<OpinionData> => {
    const [outlets, columnists, articles, themes, theses] = await Promise.all([
      rows<OpinionData["outlets"][number]>(sql`
        select o.id, o.name, o.url, o.kind, o.alignment,
          (select count(*)::int from articles a where a.outlet_id = o.id and a.published_at > now() - interval '30 days') as articles
        from outlets o where o.country_code = ${code} order by articles desc`),
      rows<OpinionData["columnists"][number]>(sql`
        select c.name, o.name as outlet, (select count(*)::int from articles a where a.columnist_id = c.id and a.published_at > now() - interval '30 days') as articles
        from columnists c join outlets o on o.id = c.outlet_id
        where o.country_code = ${code} and o.kind = 'opinion' order by articles desc, c.name limit 12`),
      rows<{ id: number; title: string; url: string; outlet: string; author: string | null; at: string; summary: string | null; theme: string | null }>(sql`
        select a.id, a.title, a.url, o.name as outlet, a.author, a.published_at as at, a.summary, a.theme
        from articles a join outlets o on o.id = a.outlet_id
        where a.country_code = ${code} order by a.published_at desc limit 12`),
      rows<OpinionData["themes"][number]>(sql`
        select theme, recent, previous, trend from theme_trends where country_code = ${code} order by (trend in ('rising','new')) desc, recent desc limit 12`),
      rows<{ text: string; mentions: number; theme: string | null; last_seen: string }>(sql`
        select text, mentions, theme, last_seen from theses where country_code = ${code} and last_seen > now() - interval '30 days' order by mentions desc, last_seen desc limit 8`),
    ]);
    return {
      outlets,
      columnists: columnists.filter((c) => c.articles > 0),
      articles: articles.map((a) => ({ ...a, at: new Date(a.at).toISOString() })),
      themes,
      theses: theses.map((t) => ({ text: t.text, mentions: t.mentions, theme: t.theme, lastSeen: new Date(t.last_seen).toISOString() })),
    };
  },
  ["country-opinion"],
  CACHE,
);
