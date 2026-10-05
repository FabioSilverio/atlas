import { revalidateTag } from "next/cache";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { runJob } from "@/ingest/lib/job";
import { GROUPS, resolveJobs } from "@/ingest/registry";

// Ingestion runs inside Vercel Cron so the database credentials never leave
// Vercel. Each group must finish within the function limit.
export const maxDuration = 300;

const MIN_HOURS_BETWEEN_UNAUTHENTICATED_RUNS = 6;

/**
 * With CRON_SECRET set, Vercel sends it as a Bearer token and we require it.
 * Without it, we only accept Vercel's cron user agent and refuse to run a group
 * more than once every few hours, so a stray request cannot hammer upstream APIs.
 */
async function authorised(req: Request, jobNames: string[]): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.headers.get("authorization") === `Bearer ${secret}`;
  if (!/vercel-cron/i.test(req.headers.get("user-agent") ?? "")) return false;
  const [last] = await db
    .select({ at: schema.ingestRuns.startedAt })
    .from(schema.ingestRuns)
    .where(and(inArray(schema.ingestRuns.job, jobNames), eq(schema.ingestRuns.status, "ok")))
    .orderBy(desc(schema.ingestRuns.startedAt))
    .limit(1);
  return !last || Date.now() - last.at.getTime() > MIN_HOURS_BETWEEN_UNAUTHENTICATED_RUNS * 3.6e6;
}

export async function GET(req: Request, ctx: RouteContext<"/api/cron/[group]">) {
  const { group } = await ctx.params;
  if (!(group in GROUPS) || group === "all") return Response.json({ error: "grupo desconhecido" }, { status: 404 });
  const jobs = resolveJobs([group]).filter((j) => j.name !== "geo");
  if (!(await authorised(req, jobs.map((j) => j.name)))) return Response.json({ error: "unauthorized" }, { status: 401 });

  const results: Record<string, string> = {};
  for (const job of jobs) {
    try {
      await runJob(job);
      results[job.name] = "ok";
    } catch (err) {
      // Keep going: a failing upstream should not block the other jobs.
      results[job.name] = `erro: ${(err as Error).message}`;
    }
  }
  revalidateTag("atlas", "max");
  return Response.json({ group, results, at: new Date().toISOString() });
}
