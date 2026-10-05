import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

/** Recent articles the local model has not processed yet (public metadata only). */
export async function GET(req: Request) {
  const limit = Math.min(200, Number(new URL(req.url).searchParams.get("limit")) || 80);
  const rows = await db.execute(sql`
    select a.id, a.title, a.url, a.language, a.country_code as country, o.name as outlet
    from articles a join outlets o on o.id = a.outlet_id
    where a.ai_processed_at is null and a.published_at > now() - interval '5 days'
    order by o.kind = 'opinion' desc, a.published_at desc limit ${limit}`);
  return Response.json({ items: rows }, { headers: { "Cache-Control": "no-store" } });
}
