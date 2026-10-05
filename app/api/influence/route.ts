import { getInfluenceFlows } from "@/lib/knowledge";

/** Country-to-country influence flows between thinkers (Wikidata P737). */
export async function GET(req: Request) {
  const code = (new URL(req.url).searchParams.get("code") ?? "").toUpperCase().slice(0, 3);
  if (!/^[A-Z]{3}$/.test(code)) return Response.json({ flows: [] });
  return Response.json({ flows: await getInfluenceFlows(code) }, { headers: { "Cache-Control": "public, s-maxage=3600" } });
}
