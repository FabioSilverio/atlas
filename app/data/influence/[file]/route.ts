import { getInfluenceFlows } from "@/lib/knowledge";
import { getMapData } from "@/lib/queries";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getMapData()).map((c) => ({ file: `${c.code}.json` }));
}

/** Country-to-country influence flows between thinkers (Wikidata P737). */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const code = (await ctx.params).file.replace(/\.json$/, "").toUpperCase();
  return Response.json({ flows: await getInfluenceFlows(code) });
}
