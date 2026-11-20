import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { FAMILY_NAME, alignmentEstimate, familyOf } from "@/lib/ideology/labels";
import { normalize } from "@/lib/ideology/normalize";
import { loadParlgov } from "../lib/datasets";
import { touchSource, type Job } from "../lib/job";
import { log } from "../lib/log";
import { countryLangs, fold } from "../lib/monitor";
import { qid, sparql } from "../lib/sparql";
import { num as parseNum } from "../lib/text";
import { chunks, wikiQids } from "../lib/wiki";

type PartyRow = { code: string; iso2: string | null; label: string; wiki: string | null; econ: string | null; galtan: string | null; src: string | null; weight: number; candidate: string | null };
type Actor = {
  countryCode: string;
  kind: "party" | "person";
  qid: string | null;
  name: string;
  aliases: Set<string>;
  partyLabel: string | null;
  econ: number | null;
  galtan: number | null;
  scoreSource: string | null;
  sitelinks: number | null;
};

const num = (v: string | null | undefined) => (v == null || v === "" ? null : Number(v));
// Aliases that would match ordinary words or every headline.
const BAD_ALIAS = /^(partido|party|parti|partei|union|unión|uniao|frente|front|alliance|alianza|movement|movimento|movimiento|liberal|liberales|democrats|democratas|republicans|republicanos|national|nacional|social|socialist|progressive|green|greens|verdes|labour|labor|centre|center|centro|people|popular|patriots|independent|independents|others|outros|otros|new|nuevo|novo)$/i;

/**
 * Political actors per country for the monitor: parties from the latest
 * elections (with their academic position, or a labelled estimate from the
 * Wikidata political alignment when no survey covers them) and their most
 * notable living members, with the names and short forms used in headlines.
 */
export const actorsJob: Job = {
  name: "actors",
  description: "partidos e políticos citáveis por país (eleições recentes + Wikidata) para o monitor",
  async run() {
    const rows = (await db.execute(sql`
      with latest as (
        select distinct on (e.country_code, e.body) e.id, e.country_code
        from elections e where e.status = 'held' and e.date > now() - interval '9 years'
        order by e.country_code, e.body, e.date desc)
      select l.country_code as code, c.iso2, r.party_label as label, r.party_wiki as wiki, r.econ, r.galtan, r.score_source as src,
             coalesce(r.seats, 0) + coalesce(r.vote_share, 0) as weight, r.candidate
      from latest l join election_results r on r.election_id = l.id join countries c on c.code = l.country_code
      where (coalesce(r.seats, 0) > 0 or coalesce(r.vote_share, 0) >= 1 or r.position <= 6)`)) as unknown as PartyRow[];

    // One actor per party (keyed by Wikipedia title), keeping the best-scored row.
    const parties = new Map<string, PartyActor>();
    const people: (Actor & { partyKey?: string })[] = [];
    for (const r of rows) {
      const code = r.code.trim();
      const key = `${code}|${r.wiki ?? r.label}`;
      const prev = parties.get(key);
      const econ = num(r.econ);
      if (!prev || (prev.econ == null && econ != null))
        parties.set(key, {
          countryCode: code, kind: "party", qid: null, name: r.label.replace(/\s*\([^)]*\)$/, ""), aliases: new Set(), partyLabel: null,
          econ, galtan: num(r.galtan), scoreSource: r.src, sitelinks: null, wiki: r.wiki, iso2: r.iso2, weight: Number(r.weight) + (prev?.weight ?? 0),
        });
      if (r.candidate) people.push({ countryCode: code, kind: "person", qid: null, name: r.candidate, aliases: new Set(), partyLabel: r.label.replace(/\s*\([^)]*\)$/, ""), econ, galtan: num(r.galtan), scoreSource: r.src, sitelinks: null, partyKey: key });
    }

    // ParlGov family means for P1142 ideology fallback when a party has no survey or P1387 alignment.
    const familyMeans = new Map<string, number>();
    {
      const acc = new Map<string, { e: number; n: number }>();
      for (const r of await loadParlgov()) {
        const e = parseNum(r.state_market);
        if (e == null) continue;
        const a = acc.get(r.family_name_short) ?? { e: 0, n: 0 };
        acc.set(r.family_name_short, { e: a.e + e, n: a.n + 1 });
      }
      for (const [f, a] of acc) familyMeans.set(f, normalize(a.e / a.n, 0, 10));
    }

    // Wikidata: the party items behind the Wikipedia titles (following redirects), their
    // short names, names in the country's languages, political alignment (P1387) and ideology (P1142).
    let failed = 0;
    const titleQid = await wikiQids([...parties.values()].map((p) => p.wiki).filter(Boolean) as string[]);
    for (const p of parties.values()) p.qid = p.wiki ? (titleQid.get(p.wiki) ?? null) : null;
    const partyByQid = new Map<string, PartyActor[]>();
    for (const p of parties.values()) if (p.qid) partyByQid.set(p.qid, [...(partyByQid.get(p.qid) ?? []), p]);
    for (const batch of chunks([...partyByQid.keys()], 60)) {
      try {
        const res = await sparql(
          `SELECT ?p ?sl (GROUP_CONCAT(DISTINCT ?nm; separator="|") AS ?names) (GROUP_CONCAT(DISTINCT ?alignLabel; separator="|") AS ?align) (GROUP_CONCAT(DISTINCT ?ideoLabel; separator="|") AS ?ideos) WHERE {
            VALUES ?p { ${batch.map((q) => `wd:${q}`).join(" ")} } ?p wikibase:sitelinks ?sl .
            OPTIONAL { { ?p wdt:P1813 ?n } UNION { ?p wdt:P1705 ?n } UNION { ?p rdfs:label ?n } UNION { ?p skos:altLabel ?n } BIND(CONCAT(LANG(?n), ":", STR(?n)) AS ?nm) }
            OPTIONAL { ?p wdt:P1387 ?al . ?al rdfs:label ?alignLabel FILTER(LANG(?alignLabel) = "en") }
            OPTIONAL { ?p wdt:P1142 ?id . ?id rdfs:label ?ideoLabel FILTER(LANG(?ideoLabel) = "en") }
          } GROUP BY ?p ?sl`,
          { ttlHours: 24 * 7 },
        );
        for (const r of res)
          for (const p of partyByQid.get(qid(r.p)!) ?? []) {
            p.sitelinks = Number(r.sl);
            const langs = new Set(countryLangs(p.iso2));
            for (const n of (r.names ?? "").split("|")) {
              const i = n.indexOf(":");
              const lang = n.slice(0, i).split("-")[0];
              // Short names (P1813) and native names (P1705) may carry any tag; labels only in the country's languages.
              if (!lang || langs.has(lang)) addAlias(p, n.slice(i + 1), "party");
            }
            if (p.econ == null) {
              const est = alignmentEstimate((r.align ?? "").split("|").filter(Boolean));
              if (est) {
                p.econ = est.value;
                p.scoreSource = `estimativa: alinhamento político no Wikidata (${est.used.join(", ")})`;
              } else {
                const fam = familyOf((r.ideos ?? "").split("|").filter(Boolean));
                if (fam && familyMeans.has(fam.family)) {
                  p.econ = familyMeans.get(fam.family)!;
                  p.scoreSource = `estimativa: família ${FAMILY_NAME[fam.family]} (Wikidata P1142 / ParlGov)`;
                }
              }
            }
          }
      } catch (err) {
        failed++;
        log.warn(`atores (partidos): ${(err as Error).message}`);
      }
    }
    for (const p of parties.values()) addAlias(p, p.name, "party");
    // Propagate enriched party positions back to election candidates (and add their surname alias).
    for (const a of people) {
      const p = a.partyKey ? parties.get(a.partyKey) : undefined;
      if (p && a.econ == null && p.econ != null) {
        a.econ = p.econ;
        a.galtan = p.galtan;
        a.scoreSource = p.scoreSource;
      }
      const last = a.name.split(" ").at(-1) ?? "";
      if (a.name.includes(" ") && last.length >= 5 && !COMMON_SURNAMES.has(fold(last))) addAlias(a, last, "person");
    }

    // Current chief executives (from governments + government_positions): always citeable with their government's position.
    const curLeaders = (await db.execute(sql`
      select g.country_code as code, pe.wikidata_qid as qid, pe.name, gp.value_norm as econ,
             (select pa.name from government_parties gpar join parties pa on pa.id = gpar.party_id
              where gpar.government_id = g.id and gpar.role = 'leader' order by gpar.position limit 1) as party_label
      from governments g
      join people pe on pe.id = case when g.chief_executive_role = 'head_of_state' then g.head_of_state_id else g.head_of_government_id end
      join government_positions gp on gp.government_id = g.id and gp.dimension = 'econ_lr'
      where g.ended_on is null and gp.value_norm is not null`)) as unknown as {
      code: string; qid: string | null; name: string; econ: string; party_label: string | null;
    }[];
    for (const l of curLeaders) {
      const a: Actor = {
        countryCode: l.code.trim(), kind: "person", qid: l.qid, name: l.name, aliases: new Set(),
        partyLabel: l.party_label, econ: Number(l.econ), galtan: null, scoreSource: "posição do governo atual", sitelinks: 100,
      };
      addAlias(a, l.name, "person");
      const last = l.name.split(" ").at(-1) ?? "";
      if (l.name.includes(" ") && last.length >= 5 && !COMMON_SURNAMES.has(fold(last))) addAlias(a, last, "person");
      people.push(a);
    }

    // Notable living members (current P102 membership only), with the names headlines use.
    for (const batch of chunks([...partyByQid.keys()], 25)) {
      try {
        const res = await sparql(
          `SELECT ?party ?m ?sl (SAMPLE(?lab) AS ?label) (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts) WHERE {
            VALUES ?party { ${batch.map((q) => `wd:${q}`).join(" ")} }
            ?m p:P102 ?st . ?st ps:P102 ?party . FILTER NOT EXISTS { ?st pq:P582 ?end }
            ?m wdt:P31 wd:Q5 ; wikibase:sitelinks ?sl . FILTER(?sl >= 25) FILTER NOT EXISTS { ?m wdt:P570 ?d }
            ?m rdfs:label ?lab FILTER(LANG(?lab) IN ("en", "mul"))
            OPTIONAL { ?m skos:altLabel ?a . BIND(CONCAT(LANG(?a), ":", STR(?a)) AS ?alt) }
          } GROUP BY ?party ?m ?sl`,
          { ttlHours: 24 * 7 },
        );
        const perParty = new Map<string, typeof res>();
        for (const r of res) perParty.set(qid(r.party)!, [...(perParty.get(qid(r.party)!) ?? []), r]);
        for (const [pq, list] of perParty) {
          const p = partyByQid.get(pq)![0];
          const langs = new Set(countryLangs(p.iso2));
          for (const r of list.sort((a, b) => Number(b.sl) - Number(a.sl)).slice(0, 15)) {
            const a: Actor = { countryCode: p.countryCode, kind: "person", qid: qid(r.m) ?? null, name: r.label, aliases: new Set(), partyLabel: p.name, econ: p.econ, galtan: p.galtan, scoreSource: p.scoreSource, sitelinks: Number(r.sl) };
            for (const n of (r.alts ?? "").split("|")) {
              const i = n.indexOf(":");
              if (langs.has(n.slice(0, i).split("-")[0]) && n.slice(i + 1).split(" ").length <= 3) addAlias(a, n.slice(i + 1), "person");
            }
            // The surname alone, when it is how the person is named ("Bolsonaro", "Milei") and not a common one.
            const last = r.label.split(" ").at(-1) ?? "";
            if (r.label.includes(" ") && last.length >= 5 && !COMMON_SURNAMES.has(fold(last)) && Number(r.sl) >= 40) addAlias(a, last, "person");
            people.push(a);
          }
        }
      } catch (err) {
        failed++;
        log.warn(`atores (membros): ${(err as Error).message}`);
      }
    }
    for (const a of people) addAlias(a, a.name, "person");

    // Merge duplicate actors (same country, kind, folded name): keep non-null econ, qid and union of aliases.
    const merged = new Map<string, Actor>();
    for (const a of [...parties.values(), ...people]) {
      const k = `${a.countryCode}|${a.kind}|${fold(a.name)}`;
      const prev = merged.get(k);
      if (!prev) {
        merged.set(k, { ...a, aliases: new Set(a.aliases) });
      } else {
        for (const al of a.aliases) prev.aliases.add(al);
        if (prev.econ == null && a.econ != null) {
          prev.econ = a.econ;
          prev.galtan = a.galtan;
          prev.scoreSource = a.scoreSource;
        }
        if (!prev.qid && a.qid) prev.qid = a.qid;
        if ((a.sitelinks ?? 0) > (prev.sitelinks ?? 0)) prev.sitelinks = a.sitelinks;
      }
    }
    const all = [...merged.values()];
    const owners = new Map<string, Set<string>>();
    for (const a of all) for (const al of a.aliases) owners.set(`${a.countryCode}|${al}`, (owners.get(`${a.countryCode}|${al}`) ?? new Set()).add(a.econ == null ? "?" : a.econ.toFixed(2)));
    for (const a of all) for (const al of [...a.aliases]) if ((owners.get(`${a.countryCode}|${al}`)?.size ?? 0) > 1 && al !== fold(a.name)) a.aliases.delete(al);

    const values = all
      .filter((a) => a.aliases.size)
      .map((a) => ({
        countryCode: a.countryCode, kind: a.kind, qid: a.qid, name: a.name.slice(0, 200), aliases: [...a.aliases].slice(0, 30), partyLabel: a.partyLabel,
        econ: a.econ == null ? null : String(a.econ), galtan: a.galtan == null ? null : String(a.galtan), scoreSource: a.scoreSource, sitelinks: a.sitelinks,
        sourceId: "wikidata", sourceUrl: a.qid ? `https://www.wikidata.org/wiki/${a.qid}` : null, updatedAt: new Date(),
      }));
    await db.transaction(async (tx) => {
      await tx.delete(schema.actors);
      for (const b of chunks(values, 300)) await tx.insert(schema.actors).values(b);
    });
    await touchSource("wikidata");
    return { parties: parties.size, people: people.length, actors: values.length, withPosition: values.filter((v) => v.econ != null).length, failedQueries: failed };
  },
};

type PartyActor = Actor & { wiki: string | null; iso2: string | null; weight: number };

const COMMON_SURNAMES = new Set(
  ("silva santos oliveira souza sousa lima pereira ferreira costa rodrigues almeida nascimento gomes martins araujo carvalho cardoso ribeiro alves faria barbosa rocha dias moreira mendes freitas " +
    "garcia lopez gonzalez hernandez martinez rodriguez perez sanchez ramirez torres flores diaz fernandez gomez ruiz jimenez moreno alvarez romero navarro " +
    "smith johnson williams brown jones miller davis wilson taylor anderson thomas moore martin white harris clark lewis young wright scott green baker adams nelson hill campbell mitchell roberts carter phillips evans turner parker collins edwards stewart morris murphy cook rogers morgan cooper " +
    "muller schmidt schneider fischer weber meyer wagner becker rossi russo ferrari bianchi romano bernard dubois robert richard petit durand nowak kowalski singh kumar sharma khan ahmed hassan mohamed ibrahim").split(" "),
);

/**
 * Adds a matchable alias. Acronyms (PT, AfD) match exactly; one-word party names
 * ("Podemos", "Novo", "Avante") are ordinary words too, so they must appear
 * capitalised and not as a headline's first word ("=" prefix); the rest is folded.
 */
function addAlias(a: { aliases: Set<string> }, raw: string | undefined, kind: "party" | "person") {
  const s = (raw ?? "").trim();
  if (!s || s.length < 2 || s.length > 60) return;
  if (/^[\p{Lu}\p{N}]{2,5}$/u.test(s) || /^[A-Z][a-z]?[A-Z]+$/.test(s)) {
    a.aliases.add(s);
    return;
  }
  const f = fold(s);
  if (f.length < 4 || BAD_ALIAS.test(f)) return;
  if (kind === "party" && !f.includes(" ")) {
    if (/^\p{Lu}/u.test(s)) a.aliases.add("=" + s);
    return;
  }
  a.aliases.add(f);
}
