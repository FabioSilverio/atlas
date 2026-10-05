import { pg } from "@/lib/db/client";
import { runJob } from "./lib/job";
import { log } from "./lib/log";
import { GROUPS, JOBS, resolveJobs } from "./registry";

async function revalidate() {
  const base = process.env.REVALIDATE_URL;
  if (!base) return;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/revalidate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
    });
    log.info(`revalidate → HTTP ${res.status}`);
  } catch (err) {
    log.warn(`revalidate falhou: ${(err as Error).message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log(`uso: npm run ingest -- <job|grupo> [...]\n\njobs: ${JOBS.map((j) => j.name).join(", ")}\ngrupos: ${Object.keys(GROUPS).join(", ")}`);
    process.exit(1);
  }
  for (const job of resolveJobs(args)) await runJob(job);
  await revalidate();
}

main()
  .catch((err) => {
    log.error(err);
    process.exitCode = 1;
  })
  .finally(() => pg.end());
