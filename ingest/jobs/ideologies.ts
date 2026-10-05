import { isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { Job } from "../lib/job";
import { qid, sparql } from "../lib/sparql";
import { chunks, wikiExtracts, wikiTitle } from "../lib/wiki";

/**
 * Political ideologies (Wikidata P1142) of the parties we track, plus the
 * ideologies/movements referenced by thinkers: names, descriptions and a
 * Wikipedia lead for the ideology pages.
 */
export const ideologiesJob: Job = {
  name: "ideologies",
  description: "ideologias dos partidos (Wikidata P1142) + descrições e resumos",
  async run() {
    const parties = await db.select({ id: schema.parties.id, qid: schema.parties.wikidataQid }).from(schema.parties).where(isNotNull(schema.parties.wikidataQid));
    const partyByQid = new Map(parties.map((p) => [p.qid!, p.id]));
    const links: { partyId: number; ideologyQid: string }[] = [];
    const names = new Map<string, string>();
    for (const batch of chunks([...partyByQid.keys()], 200)) {
      const rows = await sparql(
        `SELECT ?p ?i ?iLabel WHERE { VALUES ?p { ${batch.map((q) => `wd:${q}`).join(" ")} } ?p wdt:P1142 ?i .
          SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,pt-br,en". } }`,
        { ttlHours: 24 * 7 },
      );
      for (const r of rows) {
        const i = qid(r.i)!;
        if (r.iLabel && !/^Q\d+$/.test(r.iLabel)) names.set(i, r.iLabel);
        links.push({ partyId: partyByQid.get(qid(r.p)!)!, ideologyQid: i });
      }
    }

    const existing = await db.select({ qid: schema.ideologies.qid }).from(schema.ideologies);
    const all = [...new Set([...names.keys(), ...existing.map((e) => e.qid)])];

    // Labels, descriptions and article titles for every ideology.
    const meta = new Map<string, { pt?: string; en?: string; dpt?: string; den?: string; ptwiki?: string; enwiki?: string }>();
    for (const batch of chunks(all, 200)) {
      const rows = await sparql(
        `SELECT ?i ?pt ?en ?dpt ?den ?ptwiki ?enwiki WHERE { VALUES ?i { ${batch.map((q) => `wd:${q}`).join(" ")} }
          OPTIONAL { ?i rdfs:label ?pt FILTER(LANG(?pt) = "pt") } OPTIONAL { ?i rdfs:label ?en FILTER(LANG(?en) = "en") }
          OPTIONAL { ?i schema:description ?dpt FILTER(LANG(?dpt) = "pt") } OPTIONAL { ?i schema:description ?den FILTER(LANG(?den) = "en") }
          OPTIONAL { ?ptwiki schema:about ?i ; schema:isPartOf <https://pt.wikipedia.org/> }
          OPTIONAL { ?enwiki schema:about ?i ; schema:isPartOf <https://en.wikipedia.org/> } }`,
        { ttlHours: 24 * 30 },
      );
      for (const r of rows) meta.set(qid(r.i)!, { pt: r.pt, en: r.en, dpt: r.dpt, den: r.den, ptwiki: r.ptwiki, enwiki: r.enwiki });
    }
    const [ptEx, enEx] = await Promise.all([
      wikiExtracts("pt", all.map((q) => meta.get(q)?.ptwiki).filter(Boolean).map((u) => wikiTitle(u!)), 4),
      wikiExtracts("en", all.filter((q) => !meta.get(q)?.ptwiki && meta.get(q)?.enwiki).map((q) => wikiTitle(meta.get(q)!.enwiki!)), 4),
    ]);

    const rows = all.map((q) => {
      const m = meta.get(q) ?? {};
      const ex = m.ptwiki ? ptEx.get(wikiTitle(m.ptwiki)) : m.enwiki ? enEx.get(wikiTitle(m.enwiki)) : undefined;
      return {
        qid: q,
        name: m.pt ?? names.get(q) ?? m.en ?? q,
        nameEn: m.en ?? null,
        description: m.dpt ?? m.den ?? null,
        summary: ex?.extract ?? null,
        summaryUrl: ex?.url ?? null,
        sourceId: "wikidata",
        sourceUrl: `https://www.wikidata.org/wiki/${q}`,
        updatedAt: new Date(),
      };
    });
    for (const b of chunks(rows, 200))
      await db
        .insert(schema.ideologies)
        .values(b)
        .onConflictDoUpdate({
          target: schema.ideologies.qid,
          set: { name: sql`excluded.name`, nameEn: sql`excluded.name_en`, description: sql`excluded.description`, summary: sql`excluded.summary`, summaryUrl: sql`excluded.summary_url`, updatedAt: sql`now()` },
        });
    await db.transaction(async (tx) => {
      await tx.delete(schema.partyIdeologies);
      for (const b of chunks(links, 500)) await tx.insert(schema.partyIdeologies).values(b).onConflictDoNothing();
    });
    return { ideologies: rows.length, partyLinks: links.length };
  },
};
