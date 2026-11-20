import { getEvents } from "@/lib/queries";

export const dynamic = "force-static";

/** Latest feed events; the ticker re-reads this file every few minutes. */
export async function GET() {
  return Response.json({ generatedAt: new Date().toISOString(), events: await getEvents(30) });
}
