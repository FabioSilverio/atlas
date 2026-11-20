import { getMapData } from "@/lib/queries";
import { getPulse } from "@/lib/pulse";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getMapData()).map((c) => ({ file: `${c.code}.json` }));
}

/** One country's pulse; the dossier re-reads it every few minutes. */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const code = (await ctx.params).file.replace(/\.json$/, "").toUpperCase();
  return Response.json(await getPulse(code));
}
