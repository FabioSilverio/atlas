import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { HERRE_CATEGORY_VALUE, normalize, type Dimension } from "@/lib/ideology/normalize";
import { FAMILY_NAME, alignmentEstimate, familyOf } from "@/lib/ideology/labels";
import { qid, sparql } from "../lib/sparql";
import { chunks } from "../lib/wiki";
import { countryMatcher } from "../lib/countries";
import {
  loadChesCanada,
  loadChesEurope,
  loadChesIsrael,
  loadChesLa,
  loadGps,
  loadHerreLatest,
  loadParlgov,
  loadPartyFactsCore,
  loadPartyFactsExternal,
  URLS,
} from "../lib/datasets";
import { touchSource, type Job } from "../lib/job";
import { partyFactsNameIndex } from "../lib/partyfacts-names";
import { norm, num, sameLeader } from "../lib/text";

type Insert = typeof schema.ideologyScores.$inferInsert;
type Party = typeof schema.parties.$inferSelect;
const SOURCES = ["ches-europe-2024", "ches-la-2020", "ches-canada-2023", "ches-israel-2022", "parlgov", "gps-2019", "herre-gli", "wikidata"];

/** 0–10 expert scale → score rows for the given dimensions. */
function survey(
  party: Party,
  sourceId: string,
  sourceUrl: string,
  year: number | null,
  subjectName: string,
  values: Partial<Record<Dimension, number | null>>,
): Insert[] {
  const out: Insert[] = [];
  for (const [dim, v] of Object.entries(values) as [Dimension, number | null][]) {
    if (v == null) continue;
    out.push({
      partyId: party.id,
      dimension: dim,
      rawValue: String(v),
      scaleMin: "0",
      scaleMax: "10",
      valueNorm: String(normalize(v, 0, 10)),
      observedYear: year,
      method: "expert_survey",
      subjectName,
      sourceId,
      sourceUrl,
    });
  }
  return out;
}


export const scoresJob: Job = {
  name: "scores",
  description: "posições ideológicas: CHES, ParlGov, GPS (partidos) e Herre (líderes)",
  async run() {
    const parties = await db.select().from(schema.parties);
    const byPf = new Map(parties.filter((p) => p.partyfactsId).map((p) => [p.partyfactsId!, p]));
    const [external, core] = await Promise.all([loadPartyFactsExternal(), loadPartyFactsCore()]);
    const match = await countryMatcher();

    // dataset id → Party Facts id
    const pfOf = (dataset: string) => {
      const m = new Map<number, number>();
      for (const r of external) if (r.dataset_key === dataset && r.partyfacts_id) m.set(Number(r.dataset_party_id), Number(r.partyfacts_id));
      return m;
    };
    const chesPf = pfOf("ches");
    const parlgovPf = pfOf("parlgov");
    const gpsPf = pfOf("gps");
    // Our parties indexed by the dataset ids set in the parties job (Party Facts + manual crosswalk).
    const byId = (k: "chesId" | "gpsId" | "parlgovId") => new Map(parties.filter((p) => p[k]).map((p) => [p[k]!, p]));
    const byChes = byId("chesId");
    const byGps = byId("gpsId");
    const byParlgov = byId("parlgovId");

    // Country + name/abbreviation index for datasets that Party Facts does not link (CHES-LA, CHES-Israel).
    const ourByName = new Map<string, Party>();
    for (const p of parties) {
      if (!p.countryCode) continue;
      for (const n of [p.abbrev, p.name, p.nameEn]) if (norm(n)) ourByName.set(`${p.countryCode}|${norm(n)}`, p);
    }
    const pfByName = partyFactsNameIndex(core);
    const findByName = (country: string | undefined, names: (string | undefined)[]): Party | undefined => {
      if (!country) return;
      for (const n of names) {
        const key = `${country}|${norm(n)}`;
        const direct = ourByName.get(key);
        if (direct) return direct;
        const pf = pfByName.get(key);
        if (pf && byPf.has(pf)) return byPf.get(pf);
      }
    };

    const rows: Insert[] = [];
    const count: Record<string, number> = {};
    const add = (src: string, r: Insert[]) => {
      rows.push(...r);
      if (r.length) count[src] = (count[src] ?? 0) + 1;
    };

    // CHES Europe 2024
    for (const r of await loadChesEurope()) {
      const p = byChes.get(Number(r.party_id)) ?? byPf.get(chesPf.get(Number(r.party_id))!);
      if (p) add("ches-europe-2024", survey(p, "ches-europe-2024", URLS.chesEurope, 2024, r.party, { econ_lr: num(r.lrecon), galtan: num(r.galtan), general_lr: num(r.lrgen) }));
    }
    // CHES Canada 2023 (carries Party Facts ids itself)
    for (const r of await loadChesCanada()) {
      const p = byPf.get(Number(r.partyfacts_id));
      if (p) add("ches-canada-2023", survey(p, "ches-canada-2023", URLS.chesCanada, 2023, r.party, { econ_lr: num(r.lrecon), galtan: num(r.galtan), general_lr: num(r.lrgen) }));
    }
    // CHES Israel 2021–22
    for (const r of await loadChesIsrael()) {
      const p = byPf.get(chesPf.get(Number(r.party_id))!) ?? findByName("ISR", [r.party_name]);
      if (p) add("ches-israel-2022", survey(p, "ches-israel-2022", URLS.chesIsrael, 2022, r.party_name, { econ_lr: num(r.lrecon), galtan: num(r.galtan), general_lr: num(r.lrgen) }));
    }
    // CHES Latin America 2020
    for (const r of await loadChesLa()) {
      const p = findByName(match(r.country_en), [r.party_abb, r.party, r.party_en]);
      if (p) add("ches-la-2020", survey(p, "ches-la-2020", URLS.chesLa, 2020, `${r.party} (${r.party_abb})`, { econ_lr: num(r.lrecon), galtan: num(r.galtan), general_lr: num(r.lrgen) }));
    }
    // ParlGov: time-invariant means of several expert surveys → observedYear null.
    for (const r of await loadParlgov()) {
      const p = byParlgov.get(Number(r.party_id)) ?? byPf.get(parlgovPf.get(Number(r.party_id))!);
      if (p)
        add(
          "parlgov",
          survey(p, "parlgov", `https://www.parlgov.org/explore/party/${r.party_id}/`, null, r.party_name_english, {
            econ_lr: num(r.state_market),
            galtan: num(r.liberty_authority),
            general_lr: num(r.left_right),
          }),
        );
    }
    // Global Party Survey 2019: V4 economic left–right, V6 liberal–conservative values.
    // Party Facts' gps link is authoritative; the file's own ID_PartyFacts is sometimes stale.
    for (const r of await loadGps()) {
      const gid = Number(r.ID_GPS);
      const p = byGps.get(gid) ?? byPf.get(gpsPf.get(gid)!) ?? byPf.get(Number(r.ID_PartyFacts));
      if (p) add("gps-2019", survey(p, "gps-2019", "https://doi.org/10.7910/DVN/WMGTNS", 2019, r.Partyname, { econ_lr: num(r.V4_Scale), galtan: num(r.V6_Scale) }));
    }

    // Herre (2023): (a) the current chief executive in person; (b) party proxy from the party's 2020 leader.
    const herre = await loadHerreLatest();
    const herreUrl = "https://github.com/bastianherre/global-leader-ideologies";
    const govs = await db
      .select({ country: schema.governments.countryCode, role: schema.governments.chiefExecutiveRole, hos: schema.governments.headOfStateId, hog: schema.governments.headOfGovernmentId })
      .from(schema.governments)
      .where(isNull(schema.governments.endedOn));
    const people = await db.select({ id: schema.people.id, name: schema.people.name }).from(schema.people);
    const personName = new Map(people.map((p) => [p.id, p.name]));
    const proxySeen = new Set<number>();
    for (const r of herre) {
      const code = match(r.country_name);
      const g = govs.find((x) => x.country === code);
      const chiefId = g ? (g.role === "head_of_state" ? g.hos : g.hog) : null;
      for (const who of ["leader", "hog"] as const) {
        const label = r[`${who}_ideology`];
        const value = HERRE_CATEGORY_VALUE[label];
        if (value === undefined) continue;
        const name = r[who];
        if (chiefId && name && sameLeader(name, personName.get(chiefId) ?? "") && !rows.some((x) => x.personId === chiefId)) {
          add("herre-gli-person", [
            { personId: chiefId, dimension: "econ_lr", rawLabel: label, valueNorm: String(value), observedYear: Number(r.year), method: "leader_coding", subjectName: name, sourceId: "herre-gli", sourceUrl: herreUrl },
          ]);
        }
        const party = byPf.get(Number(r[`${who}_party_id`]));
        if (party && !proxySeen.has(party.id)) {
          proxySeen.add(party.id);
          add("herre-gli-party", [
            {
              partyId: party.id,
              dimension: "econ_lr",
              rawLabel: label,
              valueNorm: String(value),
              observedYear: Number(r.year),
              method: "leader_party_proxy",
              subjectName: name,
              notes: `${name}, ${who === "leader" ? "líder efetivo" : "chefe de governo"} em ${r.year} pelo mesmo partido, foi codificado como "${label}" por Herre (2023); usamos essa codificação como estimativa da orientação econômica do partido.`,
              sourceId: "herre-gli",
              sourceUrl: herreUrl,
            },
          ]);
        }
      }
    }

    // Confidence-D estimates for parties (and party-less leaders) no survey covers.
    // (a) Wikidata P1387 political alignment → general left–right value.
    // (b) Ideology labels (P1142) → ParlGov party family → that family's mean position in ParlGov.
    const familyMeans = new Map<string, { econ: number; gal: number; n: number }>();
    {
      const acc = new Map<string, { e: number; g: number; n: number }>();
      for (const r of await loadParlgov()) {
        const e = num(r.state_market);
        const g = num(r.liberty_authority);
        if (e == null || g == null) continue;
        const a = acc.get(r.family_name_short) ?? { e: 0, g: 0, n: 0 };
        acc.set(r.family_name_short, { e: a.e + e, g: a.g + g, n: a.n + 1 });
      }
      for (const [f, a] of acc) familyMeans.set(f, { econ: a.e / a.n, gal: a.g / a.n, n: a.n });
    }
    const surveyed = new Set(rows.filter((r) => r.method === "expert_survey" && r.partyId).map((r) => r.partyId));
    const unscored = parties.filter((p) => !surveyed.has(p.id) && p.wikidataQid);
    const alignment = new Map<string, string[]>();
    for (const batch of chunks(unscored.map((p) => p.wikidataQid!), 200)) {
      const res = await sparql(
        `SELECT ?p ?alLabel WHERE { VALUES ?p { ${batch.map((q) => `wd:${q}`).join(" ")} } ?p wdt:P1387 ?al .
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`,
        { ttlHours: 24 * 7 },
      );
      for (const r of res) alignment.set(qid(r.p)!, [...(alignment.get(qid(r.p)!) ?? []), r.alLabel]);
    }
    const ideologyLabels = new Map<number, string[]>();
    for (const r of (await db.execute(sql`select pi.party_id, coalesce(i.name_en, i.name) as label from party_ideologies pi join ideologies i on i.qid = pi.ideology_qid`)) as unknown as { party_id: number; label: string }[])
      ideologyLabels.set(r.party_id, [...(ideologyLabels.get(r.party_id) ?? []), r.label]);
    const familyRow = (subject: { partyId?: number; personId?: number }, labels: string[], subjectName: string): Insert[] => {
      const f = familyOf(labels);
      const m = f ? familyMeans.get(f.family) : undefined;
      if (!f || !m) return [];
      const notes = `rótulo “${f.matched}” (Wikidata P1142) → família ${FAMILY_NAME[f.family]}; posição média dessa família entre ${m.n} partidos do ParlGov: ${m.econ.toFixed(1)}/10 no eixo econômico e ${m.gal.toFixed(1)}/10 no cultural.`;
      return (["econ_lr", "galtan"] as const).map((dim) => ({
        ...subject,
        dimension: dim,
        rawValue: String((dim === "econ_lr" ? m.econ : m.gal).toFixed(2)),
        rawLabel: f.family,
        scaleMin: "0",
        scaleMax: "10",
        valueNorm: String(normalize(dim === "econ_lr" ? m.econ : m.gal, 0, 10)),
        observedYear: null,
        method: "family_label",
        subjectName,
        notes,
        sourceId: "parlgov",
        sourceUrl: "https://www.parlgov.org/data-info/",
      }));
    };
    for (const p of unscored) {
      const al = alignmentEstimate(alignment.get(p.wikidataQid!) ?? []);
      if (al)
        add("wikidata-alignment", [
          {
            partyId: p.id,
            dimension: "econ_lr",
            rawLabel: al.used.join(", "),
            valueNorm: String(al.value),
            method: "alignment_label",
            subjectName: p.name,
            notes: `posição política declarada no Wikidata (P1387): ${al.used.join(", ")}; usada como aproximação do eixo econômico (é uma escala geral esquerda–direita).`,
            sourceId: "wikidata",
            sourceUrl: `https://www.wikidata.org/wiki/${p.wikidataQid}#P1387`,
          },
        ]);
      add("family-label", familyRow({ partyId: p.id }, ideologyLabels.get(p.id) ?? [], p.name));
    }
    // Leaders without a party: their own ideology labels.
    const leaders = (await db.execute(sql`
      select gc.leader->>'qid' as qid, gc.leader->>'name' as name, gc.leader->'ideologies' as ideologies, pe.id as person_id
      from government_context gc join people pe on pe.wikidata_qid = gc.leader->>'qid'
      join governments g on g.country_code = gc.country_code and g.ended_on is null
      where not exists (select 1 from government_parties x where x.government_id = g.id and x.role = 'leader')`)) as unknown as { qid: string; name: string; ideologies: { qid: string }[] | null; person_id: number }[];
    const leaderIdeoQids = [...new Set(leaders.flatMap((l) => (l.ideologies ?? []).map((i) => i.qid)))];
    const enLabel = new Map<string, string>();
    for (const batch of chunks(leaderIdeoQids, 200)) {
      const res = await sparql(`SELECT ?i ?l WHERE { VALUES ?i { ${batch.map((q) => `wd:${q}`).join(" ")} } ?i rdfs:label ?l FILTER(LANG(?l) = "en") }`, { ttlHours: 24 * 30 });
      for (const r of res) enLabel.set(qid(r.i)!, r.l);
    }
    for (const l of leaders) add("family-label-leader", familyRow({ personId: l.person_id }, (l.ideologies ?? []).map((i) => enLabel.get(i.qid)).filter(Boolean) as string[], l.name));

    // Full refresh of these sources; editorial estimates (atlas-curation) are left alone.
    await db.transaction(async (tx) => {
      await tx.delete(schema.ideologyScores).where(inArray(schema.ideologyScores.sourceId, SOURCES));
      for (let i = 0; i < rows.length; i += 200) await tx.insert(schema.ideologyScores).values(rows.slice(i, i + 200));
    });
    for (const s of SOURCES) await touchSource(s);

    const [{ n }] = await db
      .select({ n: sql<number>`count(distinct ${schema.ideologyScores.partyId})::int` })
      .from(schema.ideologyScores)
      .where(and(eq(schema.ideologyScores.method, "expert_survey")));
    return { scoreRows: rows.length, partiesWithSurvey: n, ...count };
  },
};
