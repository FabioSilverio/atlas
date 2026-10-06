import { revalidateTag } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { verifyGithubActions } from "@/lib/github-oidc";

/** Thinkers still without theses, most notable first (public metadata only). */
export async function GET(req: Request) {
  const limit = Math.min(500, Number(new URL(req.url).searchParams.get("limit")) || 100);
  const rows = await db.execute(sql`
    select p.wikidata_qid as qid, p.name, t.summary_url as wiki, t.description
    from thinkers t join people p on p.id = t.person_id
    where t.theses is null and t.summary_url is not null
    order by t.sitelinks desc limit ${limit}`);
  return Response.json({ items: rows }, { headers: { "Cache-Control": "no-store" } });
}

const Body = z.object({
  model: z.string().min(1).max(80),
  items: z
    .array(
      z.object({
        qid: z.string().regex(/^Q\d+$/),
        theses: z.array(z.string().min(10).max(400)).max(6),
        concepts: z.array(z.string().min(2).max(80)).max(8),
        source: z.string().url().max(500),
      }),
    )
    .max(100),
});

/** Results from the local model (GitHub Actions, authenticated via OIDC). */
export async function POST(req: Request) {
  if (!(await verifyGithubActions(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  let updated = 0;
  for (const it of parsed.data.items) {
    const r = await db.execute(sql`
      update thinkers t set theses = ${JSON.stringify(it.theses)}::jsonb, concepts = ${JSON.stringify(it.concepts)}::jsonb,
        theses_model = ${parsed.data.model}, theses_source = ${it.source}, theses_at = now()
      from people p where p.id = t.person_id and p.wikidata_qid = ${it.qid}`);
    updated += (r as unknown as { count?: number }).count ?? 1;
  }
  revalidateTag("atlas", "max");
  return Response.json({ updated });
}
