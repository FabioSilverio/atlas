import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { log } from "./log";

export type JobStats = Record<string, number | string>;
export type Job = { name: string; description: string; run: () => Promise<JobStats> };

/** Runs a job and records it in ingest_runs. */
export async function runJob(job: Job) {
  const [run] = await db.insert(schema.ingestRuns).values({ job: job.name }).returning();
  log.info(`▶ ${job.name} — ${job.description}`);
  const t0 = Date.now();
  try {
    const stats = await job.run();
    await db
      .update(schema.ingestRuns)
      .set({ status: "ok", finishedAt: new Date(), stats })
      .where(eq(schema.ingestRuns.id, run.id));
    log.ok(`${job.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`, stats);
  } catch (err) {
    await db
      .update(schema.ingestRuns)
      .set({ status: "error", finishedAt: new Date(), error: String((err as Error).stack ?? err) })
      .where(eq(schema.ingestRuns.id, run.id));
    throw err;
  }
}

export async function touchSource(id: string) {
  await db.update(schema.sources).set({ retrievedAt: new Date() }).where(eq(schema.sources.id, id));
}
