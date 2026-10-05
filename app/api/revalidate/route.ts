import { revalidateTag } from "next/cache";

/** Called by the ingestion runner after it writes new data. Disabled when CRON_SECRET is not set. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  revalidateTag("atlas", "max");
  return Response.json({ revalidated: true, at: new Date().toISOString() });
}
