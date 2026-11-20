import { searchIndex } from "@/lib/search";

export const dynamic = "force-static";

/** The whole search index, searched in the browser (lib/search-client.ts). */
export async function GET() {
  return Response.json({ generatedAt: new Date().toISOString(), rows: await searchIndex() });
}
