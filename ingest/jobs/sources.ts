import sourcesSeed from "@/data/seed/sources.json";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { Job } from "../lib/job";

export const sourcesJob: Job = {
  name: "sources",
  description: "registro de fontes (data/seed/sources.json)",
  async run() {
    const rows = sourcesSeed as (typeof schema.sources.$inferInsert)[];
    await db
      .insert(schema.sources)
      .values(rows)
      .onConflictDoUpdate({
        target: schema.sources.id,
        set: {
          name: sql`excluded.name`,
          publisher: sql`excluded.publisher`,
          url: sql`excluded.url`,
          license: sql`excluded.license`,
          citation: sql`excluded.citation`,
          version: sql`excluded.version`,
        },
      });
    return { sources: rows.length };
  },
};
