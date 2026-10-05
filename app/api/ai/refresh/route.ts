import { revalidateTag } from "next/cache";
import { verifyGithubActions } from "@/lib/github-oidc";
import { runJob } from "@/ingest/lib/job";
import { opinionJob, themesJob } from "@/ingest/jobs/opinion";

export const maxDuration = 300;

/**
 * Lets the AI workflow refresh feeds/themes more often than Vercel's daily cron
 * allows on the Hobby plan. Authenticated with GitHub Actions OIDC.
 */
export async function POST(req: Request) {
  if (!(await verifyGithubActions(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const only = new URL(req.url).searchParams.get("only");
  const jobs = only === "themes" ? [themesJob] : [opinionJob, themesJob];
  const results: Record<string, string> = {};
  for (const j of jobs) {
    try {
      await runJob(j);
      results[j.name] = "ok";
    } catch (err) {
      results[j.name] = `erro: ${(err as Error).message}`;
    }
  }
  revalidateTag("atlas", "max");
  return Response.json({ results });
}
