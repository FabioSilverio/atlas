// What the local model (scripts/ai-worker.mjs) reads and writes. Served to it by
// scripts/ai-bridge.ts on localhost inside the GitHub Actions pipeline.
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { similar } from "@/lib/ideology/text-similarity";

/** Recent articles the local model has not processed yet (public metadata only). */
export async function pendingArticles(limit: number) {
  return db.execute(sql`
    select a.id, a.title, a.url, a.language, a.country_code as country, o.name as outlet
    from articles a join outlets o on o.id = a.outlet_id
    where a.ai_processed_at is null and a.published_at > now() - interval '5 days'
    order by o.kind = 'opinion' desc, a.published_at desc limit ${Math.min(200, limit || 80)}`);
}

export const ArticleResults = z.object({
  model: z.string().min(1).max(80),
  items: z.array(z.object({ id: z.number().int(), summary: z.string().max(600).nullable(), theme: z.string().max(60).nullable(), theses: z.array(z.string().min(8).max(240)).max(3) })).max(100),
});

export async function saveArticleResults({ model, items }: z.infer<typeof ArticleResults>) {
  if (!items.length) return { updated: 0, newTheses: 0 };
  const arts = await db
    .select({ id: schema.articles.id, country: schema.articles.countryCode, at: schema.articles.publishedAt })
    .from(schema.articles)
    .where(inArray(schema.articles.id, items.map((i) => i.id)));
  const byId = new Map(arts.map((a) => [a.id, a]));
  const countries = [...new Set(arts.map((a) => a.country))];
  // Existing recent theses per country, for de-duplication.
  const recent = countries.length
    ? await db.select().from(schema.theses).where(and(inArray(schema.theses.countryCode, countries), gte(schema.theses.lastSeen, new Date(Date.now() - 45 * 864e5))))
    : [];
  let updated = 0;
  let newTheses = 0;
  for (const it of items) {
    const a = byId.get(it.id);
    if (!a) continue;
    const theme = it.theme?.trim().toLowerCase() || null;
    await db.update(schema.articles).set({ summary: it.summary?.trim() || null, theme, summaryModel: model, aiProcessedAt: new Date() }).where(eq(schema.articles.id, it.id));
    updated++;
    for (const t of it.theses) {
      const text = t.trim().replace(/\s+/g, " ");
      const match = recent.find((r) => r.countryCode === a.country && similar(r.text, text));
      if (match) {
        match.mentions++;
        match.lastSeen = a.at > match.lastSeen ? a.at : match.lastSeen;
        await db.update(schema.theses).set({ mentions: match.mentions, lastSeen: match.lastSeen }).where(eq(schema.theses.id, match.id));
        await db.insert(schema.thesisMentions).values({ thesisId: match.id, articleId: a.id }).onConflictDoNothing();
      } else {
        const [row] = await db.insert(schema.theses).values({ countryCode: a.country, text, theme, model, firstSeen: a.at, lastSeen: a.at, mentions: 1 }).returning();
        recent.push(row);
        await db.insert(schema.thesisMentions).values({ thesisId: row.id, articleId: a.id }).onConflictDoNothing();
        newTheses++;
      }
    }
  }
  return { updated, newTheses };
}

/** Thinkers still without theses, most notable first (public metadata only). */
export async function pendingThinkers(limit: number) {
  return db.execute(sql`
    select p.wikidata_qid as qid, p.name, t.summary_url as wiki, t.description
    from thinkers t join people p on p.id = t.person_id
    where t.theses is null and t.summary_url is not null
    order by t.sitelinks desc limit ${Math.min(500, limit || 100)}`);
}

export const ThinkerResults = z.object({
  model: z.string().min(1).max(80),
  items: z.array(z.object({ qid: z.string().regex(/^Q\d+$/), theses: z.array(z.string().min(10).max(400)).max(6), concepts: z.array(z.string().min(2).max(80)).max(8), source: z.string().url().max(500) })).max(100),
});

export async function saveThinkerResults({ model, items }: z.infer<typeof ThinkerResults>) {
  for (const it of items)
    await db.execute(sql`
      update thinkers t set theses = ${JSON.stringify(it.theses)}::jsonb, concepts = ${JSON.stringify(it.concepts)}::jsonb,
        theses_model = ${model}, theses_source = ${it.source}, theses_at = now()
      from people p where p.id = t.person_id and p.wikidata_qid = ${it.qid}`);
  return { updated: items.length };
}
