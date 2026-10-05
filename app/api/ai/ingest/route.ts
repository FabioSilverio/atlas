import { revalidateTag } from "next/cache";
import { and, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { verifyGithubActions } from "@/lib/github-oidc";
import { similar } from "@/lib/ideology/text-similarity";

const Body = z.object({
  model: z.string().min(1).max(80),
  items: z
    .array(
      z.object({
        id: z.number().int(),
        summary: z.string().max(600).nullable(),
        theme: z.string().max(60).nullable(),
        theses: z.array(z.string().min(8).max(240)).max(3),
      }),
    )
    .max(100),
});

/** Results from the local model running in GitHub Actions (authenticated via GitHub OIDC). */
export async function POST(req: Request) {
  if (!(await verifyGithubActions(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const { model, items } = parsed.data;
  if (!items.length) return Response.json({ updated: 0 });

  const arts = await db
    .select({ id: schema.articles.id, country: schema.articles.countryCode, at: schema.articles.publishedAt })
    .from(schema.articles)
    .where(inArray(schema.articles.id, items.map((i) => i.id)));
  const byId = new Map(arts.map((a) => [a.id, a]));
  const countries = [...new Set(arts.map((a) => a.country))];
  // Existing recent theses per country, for de-duplication.
  const recent = countries.length
    ? await db
        .select()
        .from(schema.theses)
        .where(and(inArray(schema.theses.countryCode, countries), gte(schema.theses.lastSeen, new Date(Date.now() - 45 * 864e5))))
    : [];

  let updated = 0;
  let newTheses = 0;
  for (const it of items) {
    const a = byId.get(it.id);
    if (!a) continue;
    const theme = it.theme?.trim().toLowerCase() || null;
    await db
      .update(schema.articles)
      .set({ summary: it.summary?.trim() || null, theme, summaryModel: model, aiProcessedAt: new Date() })
      .where(eq(schema.articles.id, it.id));
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
        const [row] = await db
          .insert(schema.theses)
          .values({ countryCode: a.country, text, theme, model, firstSeen: a.at, lastSeen: a.at, mentions: 1 })
          .returning();
        recent.push(row);
        await db.insert(schema.thesisMentions).values({ thesisId: row.id, articleId: a.id }).onConflictDoNothing();
        newTheses++;
      }
    }
  }
  revalidateTag("atlas", "max");
  return Response.json({ updated, newTheses });
}
