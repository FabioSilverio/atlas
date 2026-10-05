import { inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { countriesByQid } from "../lib/countries";
import { touchSource, type Job } from "../lib/job";
import { log } from "../lib/log";
import { qid, sparql } from "../lib/sparql";
import { chunks, commonsInfo, wikiExtracts, wikiTitle } from "../lib/wiki";

// Intellectual occupations and the minimum number of Wikipedia editions
// (sitelinks) used as a notability floor. Historians are numerous, hence the higher bar.
const OCCUPATIONS: [string, string, number][] = [
  ["Q4964182", "filósofo", 12],
  ["Q188094", "economista", 12],
  ["Q2306091", "sociólogo", 10],
  ["Q1238570", "cientista político", 10],
  ["Q4773904", "antropólogo", 12],
  ["Q15958642", "escritor político", 12],
  ["Q201788", "historiador", 25],
  ["Q11774202", "ensaísta", 25],
];
const PER_COUNTRY = 40;

type Ref = { qid: string; label: string };

export const thinkersJob: Job = {
  name: "thinkers",
  description: "pensadores e intelectuais por país (Wikidata) + influências P737 + resumo Wikipédia",
  async run() {
    // 1. Candidates.
    const cand = new Map<string, { sl: number; occ: Set<string> }>();
    for (const [occ, , min] of OCCUPATIONS) {
      const rows = await sparql(
        `SELECT ?p ?sl WHERE { ?p wdt:P106 wd:${occ} ; wikibase:sitelinks ?sl . FILTER(?sl >= ${min}) ?p wdt:P31 wd:Q5 . }`,
        { ttlHours: 24 * 7 },
      );
      for (const r of rows) {
        const q = qid(r.p)!;
        const c = cand.get(q) ?? { sl: Number(r.sl), occ: new Set<string>() };
        c.occ.add(occ);
        cand.set(q, c);
      }
    }
    log.info(`candidatos: ${cand.size}`);

    // 2. Countries (citizenship ∪ birthplace country, modern borders only).
    const byQid = await countriesByQid();
    const countries = new Map<string, { cit: Set<string>; birth: Set<string> }>();
    for (const batch of chunks([...cand.keys()], 300)) {
      const values = batch.map((q) => `wd:${q}`).join(" ");
      const rows = await sparql(
        `SELECT ?p ?c ?kind WHERE { VALUES ?p { ${values} }
          { ?p wdt:P27 ?c . BIND("cit" AS ?kind) } UNION { ?p wdt:P19/wdt:P17 ?c . BIND("birth" AS ?kind) } }`,
        { ttlHours: 24 * 30 },
      );
      for (const r of rows) {
        const code = byQid.get(qid(r.c)!);
        if (!code) continue;
        const p = qid(r.p)!;
        const e = countries.get(p) ?? { cit: new Set(), birth: new Set() };
        (r.kind === "cit" ? e.cit : e.birth).add(code);
        countries.set(p, e);
      }
    }
    const primary = (q: string) => {
      const e = countries.get(q);
      if (!e) return null;
      const both = [...e.cit].find((c) => e.birth.has(c));
      return both ?? [...e.cit][0] ?? [...e.birth][0] ?? null;
    };

    // 3. Keep the most notable per country.
    const perCountry = new Map<string, string[]>();
    for (const [q] of [...cand.entries()].sort((a, b) => b[1].sl - a[1].sl)) {
      const c = primary(q);
      if (!c) continue;
      const list = perCountry.get(c) ?? [];
      if (list.length < PER_COUNTRY) list.push(q);
      perCountry.set(c, list);
    }
    const selected = [...perCountry.values()].flat();
    log.info(`selecionados: ${selected.length} em ${perCountry.size} países`);

    // 4. Details.
    type Detail = {
      label?: string; labelEn?: string; desc?: string; descEn?: string; birth?: string; death?: string;
      image?: string; ptwiki?: string; enwiki?: string;
      fields: Map<string, string>; movements: Map<string, string>; ideologies: Map<string, string>;
      works: Map<string, string>; awards: Map<string, string>; occupations: Map<string, string>;
    };
    const det = new Map<string, Detail>();
    const get = (q: string) => {
      let d = det.get(q);
      if (!d) {
        d = { fields: new Map(), movements: new Map(), ideologies: new Map(), works: new Map(), awards: new Map(), occupations: new Map() };
        det.set(q, d);
      }
      return d;
    };
    for (const batch of chunks(selected, 150)) {
      const values = batch.map((q) => `wd:${q}`).join(" ");
      const basic = await sparql(
        `SELECT ?p ?pt ?en ?dpt ?den ?birth ?death ?img ?ptwiki ?enwiki WHERE { VALUES ?p { ${values} }
          OPTIONAL { ?p rdfs:label ?pt FILTER(LANG(?pt) = "pt") }
          OPTIONAL { ?p rdfs:label ?en FILTER(LANG(?en) = "en") }
          OPTIONAL { ?p schema:description ?dpt FILTER(LANG(?dpt) = "pt") }
          OPTIONAL { ?p schema:description ?den FILTER(LANG(?den) = "en") }
          OPTIONAL { ?p wdt:P569 ?birth } OPTIONAL { ?p wdt:P570 ?death } OPTIONAL { ?p wdt:P18 ?img }
          OPTIONAL { ?ptwiki schema:about ?p ; schema:isPartOf <https://pt.wikipedia.org/> }
          OPTIONAL { ?enwiki schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> } }`,
        { ttlHours: 24 * 30 },
      );
      for (const r of basic) {
        const d = get(qid(r.p)!);
        d.label ??= r.pt;
        d.labelEn ??= r.en;
        d.desc ??= r.dpt;
        d.descEn ??= r.den;
        d.birth ??= r.birth;
        d.death ??= r.death;
        d.image ??= r.img ? decodeURIComponent(r.img.split("/").pop()!) : undefined;
        d.ptwiki ??= r.ptwiki;
        d.enwiki ??= r.enwiki;
      }
      const multi = await sparql(
        `SELECT ?p ?k ?v ?vLabel WHERE { VALUES ?p { ${values} }
          { ?p wdt:P101 ?v . BIND("fields" AS ?k) } UNION { ?p wdt:P135 ?v . BIND("movements" AS ?k) }
          UNION { ?p wdt:P1142 ?v . BIND("ideologies" AS ?k) } UNION { ?p wdt:P800 ?v . BIND("works" AS ?k) }
          UNION { ?p wdt:P166 ?v . ?v wikibase:sitelinks ?asl . FILTER(?asl >= 20) BIND("awards" AS ?k) }
          UNION { ?p wdt:P106 ?v . BIND("occupations" AS ?k) }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,pt-br,en". } }`,
        { ttlHours: 24 * 30 },
      );
      for (const r of multi) {
        if (!r.vLabel || /^Q\d+$/.test(r.vLabel)) continue;
        get(qid(r.p)!)[r.k as "fields"].set(qid(r.v)!, r.vLabel);
      }
    }

    // 5. Influence edges within the selected set (P737 "influenced by").
    const selectedSet = new Set(selected);
    const edges: [string, string][] = [];
    for (const batch of chunks(selected, 300)) {
      const rows = await sparql(`SELECT ?p ?inf WHERE { VALUES ?p { ${batch.map((q) => `wd:${q}`).join(" ")} } ?p wdt:P737 ?inf . }`, { ttlHours: 24 * 30 });
      for (const r of rows) {
        const inf = qid(r.inf)!;
        if (selectedSet.has(inf)) edges.push([inf, qid(r.p)!]);
      }
    }

    // 6. Summaries (pt, falling back to en) and images with attribution — only for
    // thinkers we have not described yet, so the weekly refresh fits a serverless run.
    const known = new Map(
      (
        (await db.execute(sql`select p.wikidata_qid as qid, t.summary, t.summary_url, p.image_url, p.image_license, p.image_attribution
          from thinkers t join people p on p.id = t.person_id`)) as unknown as { qid: string; summary: string | null; summary_url: string | null; image_url: string | null; image_license: string | null; image_attribution: string | null }[]
      ).map((r) => [r.qid, r]),
    );
    const needText = selected.filter((q) => !known.get(q)?.summary);
    const ptTitles = needText.map((q) => det.get(q)?.ptwiki).filter(Boolean).map((u) => wikiTitle(u!));
    const enTitles = needText.filter((q) => !det.get(q)?.ptwiki && det.get(q)?.enwiki).map((q) => wikiTitle(det.get(q)!.enwiki!));
    const [ptEx, enEx] = await Promise.all([wikiExtracts("pt", ptTitles), wikiExtracts("en", enTitles)]);
    const images = await commonsInfo(selected.filter((q) => !known.get(q)?.image_url).map((q) => det.get(q)?.image).filter(Boolean) as string[]);

    // 7. Write.
    const year = (d?: string) => (d && /^-?\d{4}/.test(d) ? Number(d.slice(0, d.startsWith("-") ? 5 : 4)) : null);
    const idByQid = new Map<string, number>();
    for (const batch of chunks(selected, 200)) {
      const rows = batch.map((q) => {
        const d = det.get(q);
        const img = d?.image ? images.get(d.image) : undefined;
        const k = known.get(q);
        return {
          wikidataQid: q,
          name: d?.label ?? d?.labelEn ?? q,
          birthDate: d?.birth && /^\d{4}-\d{2}-\d{2}/.test(d.birth) ? d.birth.slice(0, 10) : null,
          deathDate: d?.death && /^\d{4}-\d{2}-\d{2}/.test(d.death) ? d.death.slice(0, 10) : null,
          birthCountryCode: [...(countries.get(q)?.birth ?? [])][0] ?? null,
          imageUrl: img?.thumb ?? k?.image_url ?? null,
          imageLicense: img?.license ?? k?.image_license ?? null,
          imageAttribution: img ? `${img.artist ?? "Wikimedia Commons"} · ${img.page}` : (k?.image_attribution ?? null),
          sourceId: "wikidata",
          sourceUrl: `https://www.wikidata.org/wiki/${q}`,
        };
      });
      const ins = await db
        .insert(schema.people)
        .values(rows)
        .onConflictDoUpdate({
          target: schema.people.wikidataQid,
          set: {
            name: sql`excluded.name`,
            birthDate: sql`excluded.birth_date`,
            deathDate: sql`excluded.death_date`,
            birthCountryCode: sql`coalesce(excluded.birth_country_code, ${schema.people.birthCountryCode})`,
            imageUrl: sql`excluded.image_url`,
            imageLicense: sql`excluded.image_license`,
            imageAttribution: sql`excluded.image_attribution`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: schema.people.id, qid: schema.people.wikidataQid });
      for (const r of ins) idByQid.set(r.qid!, r.id);
    }

    const list = (m?: Map<string, string>, n = 12): Ref[] => [...(m ?? new Map()).entries()].slice(0, n).map(([q, label]) => ({ qid: q, label }));
    const thinkerRows = selected.map((q) => {
      const d = det.get(q);
      const k = known.get(q);
      const ex = k?.summary
        ? { extract: k.summary, url: k.summary_url ?? "" }
        : d?.ptwiki
          ? ptEx.get(wikiTitle(d.ptwiki))
          : d?.enwiki
            ? enEx.get(wikiTitle(d.enwiki))
            : undefined;
      const occs = list(d?.occupations, 8);
      return {
        personId: idByQid.get(q)!,
        occupations: occs,
        fields: list(d?.fields),
        movements: list(d?.movements),
        notableWorks: list(d?.works, 10),
        awards: list(d?.awards, 8),
        sitelinks: cand.get(q)!.sl,
        description: d?.desc ?? d?.descEn ?? null,
        summary: ex?.extract ?? null,
        summaryUrl: ex?.url ?? null,
        birthYear: year(d?.birth),
        deathYear: year(d?.death),
        primaryCountry: primary(q),
        sourceId: "wikidata",
        sourceUrl: `https://www.wikidata.org/wiki/${q}`,
        updatedAt: new Date(),
      };
    });
    await db.transaction(async (tx) => {
      const ids = thinkerRows.map((r) => r.personId);
      await tx.delete(schema.thinkerCountries).where(inArray(schema.thinkerCountries.personId, ids));
      await tx.delete(schema.thinkerInfluences);
      await tx.delete(schema.thinkerIdeologies);
      await tx.delete(schema.thinkers);
      for (const b of chunks(thinkerRows, 200)) await tx.insert(schema.thinkers).values(b);
      const tc = selected.flatMap((q) => {
        const e = countries.get(q);
        const id = idByQid.get(q)!;
        return [
          ...[...(e?.cit ?? [])].map((c) => ({ personId: id, countryCode: c, relation: "citizenship" })),
          ...[...(e?.birth ?? [])].map((c) => ({ personId: id, countryCode: c, relation: "birth" })),
        ];
      });
      for (const b of chunks(tc, 500)) await tx.insert(schema.thinkerCountries).values(b).onConflictDoNothing();
      const ti = edges.map(([a, b]) => ({ influencerId: idByQid.get(a)!, influencedId: idByQid.get(b)!, sourceUrl: `https://www.wikidata.org/wiki/${b}#P737` }));
      for (const b of chunks(ti, 500)) await tx.insert(schema.thinkerInfluences).values(b).onConflictDoNothing();

      // Ideologies/movements referenced by thinkers.
      const ideo = new Map<string, string>();
      for (const q of selected) for (const m of [det.get(q)?.ideologies, det.get(q)?.movements]) for (const [k, v] of m ?? []) ideo.set(k, v);
      const ideoRows = [...ideo].map(([k, v]) => ({ qid: k, name: v, sourceId: "wikidata", sourceUrl: `https://www.wikidata.org/wiki/${k}` }));
      for (const b of chunks(ideoRows, 300))
        await tx.insert(schema.ideologies).values(b).onConflictDoNothing();
      const thi = selected.flatMap((q) => [
        ...[...(det.get(q)?.ideologies ?? new Map()).keys()].map((k) => ({ personId: idByQid.get(q)!, ideologyQid: k, relation: "ideology" })),
        ...[...(det.get(q)?.movements ?? new Map()).keys()].map((k) => ({ personId: idByQid.get(q)!, ideologyQid: k, relation: "movement" })),
      ]);
      for (const b of chunks(thi, 500)) await tx.insert(schema.thinkerIdeologies).values(b).onConflictDoNothing();
    });

    await touchSource("wikidata");
    return { candidates: cand.size, thinkers: selected.length, countries: perCountry.size, influences: edges.length, withSummary: thinkerRows.filter((r) => r.summary).length, withImage: images.size };
  },
};
