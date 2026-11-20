import { pg } from "@/lib/db/client";
import { runJob } from "./lib/job";
import { log } from "./lib/log";
import { GROUPS, JOBS, resolveJobs } from "./registry";

async function main() {
  const args = process.argv.slice(2);
  // --keep-going: a failing job is logged and the next ones still run (the hourly pipeline).
  const keepGoing = args.includes("--keep-going");
  const names = args.filter((a) => !a.startsWith("--"));
  if (!names.length) {
    console.log(`uso: npm run ingest -- [--keep-going] <job|grupo> [...]\n\njobs: ${JOBS.map((j) => j.name).join(", ")}\ngrupos: ${Object.keys(GROUPS).join(", ")}`);
    process.exit(1);
  }
  // Each job once, in registry order, however many groups ask for it.
  const wanted = new Set(resolveJobs(names).map((j) => j.name));
  const failed: string[] = [];
  for (const job of JOBS.filter((j) => wanted.has(j.name))) {
    try {
      await runJob(job);
    } catch (err) {
      if (!keepGoing) throw err;
      failed.push(job.name);
      log.error(`${job.name} falhou: ${(err as Error).message}`);
    }
  }
  if (failed.length) log.warn(`jobs com falha: ${failed.join(", ")}`);
}

main()
  .catch((err) => {
    log.error(err);
    process.exitCode = 1;
  })
  .finally(() => pg.end());
