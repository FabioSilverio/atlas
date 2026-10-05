import { getEvents } from "@/lib/queries";

/** Latest feed events; the ticker polls this every minute. */
export async function GET() {
  return Response.json({ events: await getEvents(30) }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
