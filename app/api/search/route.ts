import { search } from "@/lib/search";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 120) ?? "";
  const hits = q.trim().length >= 2 ? await search(q, 20) : [];
  return Response.json({ q, hits }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
}
