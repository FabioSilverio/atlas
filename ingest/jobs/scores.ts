import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import estimatesSeed from "@/data/seed/overrides/estimates.json";
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
import { log } from "../lib/log";
import { partyFactsNameIndex } from "../lib/partyfacts-names";
import { norm, num, sameLeader } from "../lib/text";

type Insert = typeof schema.ideologyScores.$inferInsert;
type Estimate = {
  applies_to: "regime" | "chief";
  regimes?: string[];
  for_chief?: string;
  econ_lr?: { value: number; label: string };
  galtan?: { value: number; label: string };
  justification: string;
  source_url: string;
  verified_at: string;
};
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
    const partyWikidataIdeos = new Map<string, string[]>();
    for (const batch of chunks(unscored.map((p) => p.wikidataQid!), 150)) {
      const res = await sparql(
        `SELECT ?p (GROUP_CONCAT(DISTINCT ?alLabel; separator="|") AS ?als) (GROUP_CONCAT(DISTINCT ?idLabel; separator="|") AS ?ids) WHERE {
          VALUES ?p { ${batch.map((q) => `wd:${q}`).join(" ")} }
          OPTIONAL { ?p wdt:P1387 ?al . ?al rdfs:label ?alLabel FILTER(LANG(?alLabel) IN ("en", "mul")) }
          OPTIONAL { ?p wdt:P1142 ?id . ?id rdfs:label ?idLabel FILTER(LANG(?idLabel) IN ("en", "mul")) }
        } GROUP BY ?p`,
        { ttlHours: 24 * 7 },
      );
      for (const r of res) {
        const pq = qid(r.p)!;
        if (r.als) alignment.set(pq, r.als.split("|").filter(Boolean));
        if (r.ids) partyWikidataIdeos.set(pq, r.ids.split("|").filter(Boolean));
      }
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
      const combinedIdeos = [...new Set([...(ideologyLabels.get(p.id) ?? []), ...(partyWikidataIdeos.get(p.wikidataQid!) ?? [])])];
      add("family-label", familyRow({ partyId: p.id }, combinedIdeos, p.name));
    }
    // Current chief executives: own Wikidata P1387/P1142 and historical/suspended P102 party labels as confidence-D fallback.
    const curChiefs = (await db.execute(sql`
      select distinct pe.id as person_id, pe.wikidata_qid as qid, pe.name
      from governments g
      join people pe on pe.id = case when g.chief_executive_role = 'head_of_state' then g.head_of_state_id else g.head_of_government_id end
      where g.ended_on is null and pe.wikidata_qid is not null`)) as unknown as { person_id: number; qid: string; name: string }[];
    const chiefByQid = new Map(curChiefs.map((c) => [c.qid, c]));
    for (const batch of chunks([...chiefByQid.keys()], 100)) {
      const res = await sparql(
        `SELECT ?p
          (GROUP_CONCAT(DISTINCT ?al; separator="|") AS ?als)
          (GROUP_CONCAT(DISTINCT ?il; separator="|") AS ?ils)
          (GROUP_CONCAT(DISTINCT ?pal; separator="|") AS ?pals)
          (GROUP_CONCAT(DISTINCT ?pil; separator="|") AS ?pils)
        WHERE {
          VALUES ?p { ${batch.map((q) => `wd:${q}`).join(" ")} }
          OPTIONAL { ?p wdt:P1387 ?a . ?a rdfs:label ?al FILTER(LANG(?al) IN ("en", "mul")) }
          OPTIONAL { ?p wdt:P1142 ?i . ?i rdfs:label ?il FILTER(LANG(?il) IN ("en", "mul")) }
          OPTIONAL {
            ?p wdt:P102 ?pt . FILTER(?pt NOT IN (wd:Q327591, wd:Q7049542))
            OPTIONAL { ?pt wdt:P1387 ?pa . ?pa rdfs:label ?pal FILTER(LANG(?pal) IN ("en", "mul")) }
            OPTIONAL { ?pt wdt:P1142 ?pi . ?pi rdfs:label ?pil FILTER(LANG(?pil) IN ("en", "mul")) }
          }
        } GROUP BY ?p`,
        { ttlHours: 24 * 7 },
      );
      for (const r of res) {
        const c = chiefByQid.get(qid(r.p)!);
        if (!c) continue;
        const ownAl = alignmentEstimate((r.als ?? "").split("|").filter(Boolean));
        const partyAl = !ownAl ? alignmentEstimate((r.pals ?? "").split("|").filter(Boolean)) : null;
        const al = ownAl ?? partyAl;
        if (al) {
          add("wikidata-alignment-leader", [
            {
              personId: c.person_id,
              dimension: "econ_lr",
              rawLabel: al.used.join(", "),
              valueNorm: String(al.value),
              method: "alignment_label",
              subjectName: c.name,
              notes: ownAl
                ? `posição política declarada no Wikidata (P1387): ${al.used.join(", ")}.`
                : `posição política de partido histórico/vinculado no Wikidata (P102/P1387): ${al.used.join(", ")}.`,
              sourceId: "wikidata",
              sourceUrl: `https://www.wikidata.org/wiki/${c.qid}`,
            },
          ]);
        }
        const ideos = [...(r.ils ?? "").split("|").filter(Boolean), ...(r.pils ?? "").split("|").filter(Boolean)];
        if (ideos.length) add("family-label-leader", familyRow({ personId: c.person_id }, ideos, c.name));
      }
    }

    // Editorial estimates (data/seed/overrides/estimates.json), attached to the current chief
    // executive only while the entry still applies: same regime type, or the same person.
    const chiefsNow = (await db.execute(sql`
      select c.code, c.regime_type as regime, pe.id as person_id, pe.name, pe.name_native as name_en
      from governments g
      join countries c on c.code = g.country_code
      join people pe on pe.id = case when g.chief_executive_role = 'head_of_state' then g.head_of_state_id else g.head_of_government_id end
      where g.ended_on is null`)) as unknown as { code: string; regime: string | null; person_id: number; name: string; name_en: string | null }[];
    const editorial: Insert[] = [];
    for (const g of chiefsNow) {
      const e = (estimatesSeed as unknown as Record<string, Estimate>)[g.code.trim()];
      if (!e || typeof e !== "object" || !("justification" in e)) continue;
      const applies = e.applies_to === "regime"
        ? !e.regimes?.length || (g.regime != null && e.regimes.includes(g.regime))
        : sameLeader(e.for_chief ?? "", g.name) || sameLeader(e.for_chief ?? "", g.name_en ?? "");
      if (!applies) {
        log.warn(`${g.code}: estimativa editorial não se aplica mais (${e.applies_to === "regime" ? `regime ${g.regime}` : `chefe ${g.name}`}); ignorada`);
        continue;
      }
      for (const dim of ["econ_lr", "galtan"] as const) {
        const v = e[dim];
        if (!v) continue;
        editorial.push({
          personId: g.person_id,
          dimension: dim,
          rawLabel: v.label,
          valueNorm: String(v.value),
          method: "editorial_estimate",
          subjectName: g.name,
          notes: `${e.justification}${e.applies_to === "regime" ? " A estimativa descreve o regime e vale enquanto o tipo de regime não mudar." : ""}`,
          sourceId: "atlas-curation",
          sourceUrl: e.source_url,
        });
      }
    }
    count["editorial-estimate"] = editorial.length;

    // Full refresh of these sources and of the editorial estimates.
    await db.transaction(async (tx) => {
      await tx.delete(schema.ideologyScores).where(inArray(schema.ideologyScores.sourceId, SOURCES));
      await tx.delete(schema.ideologyScores).where(and(eq(schema.ideologyScores.sourceId, "atlas-curation"), eq(schema.ideologyScores.method, "editorial_estimate")));
      const all = [...rows, ...editorial];
      for (let i = 0; i < all.length; i += 200) await tx.insert(schema.ideologyScores).values(all.slice(i, i + 200));
    });
    for (const s of SOURCES) await touchSource(s);

    const [{ n }] = await db
      .select({ n: sql<number>`count(distinct ${schema.ideologyScores.partyId})::int` })
      .from(schema.ideologyScores)
      .where(and(eq(schema.ideologyScores.method, "expert_survey")));
    return { scoreRows: rows.length, partiesWithSurvey: n, ...count };
  },
};
