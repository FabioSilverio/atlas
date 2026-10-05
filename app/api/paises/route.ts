import { getMapData } from "@/lib/queries";

/** Public JSON of the map layer: one row per country, with confidence. */
export async function GET() {
  const data = await getMapData();
  return Response.json(
    { generatedAt: new Date().toISOString(), scale: "value_norm: -1 (esquerda / libertário) … +1 (direita / autoritário)", countries: data },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
