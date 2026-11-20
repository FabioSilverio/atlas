import type { Job } from "./lib/job";
import { sourcesJob } from "./jobs/sources";
import { geoJob } from "./jobs/geo";
import { regimesJob } from "./jobs/regimes";
import { governmentsJob } from "./jobs/governments";
import { partiesJob } from "./jobs/parties";
import { scoresJob } from "./jobs/scores";
import { deriveJob } from "./jobs/derive";
import { nobelJob } from "./jobs/nobel";
import { thinkersJob } from "./jobs/thinkers";
import { ideologiesJob } from "./jobs/ideologies";
import { electionsJob } from "./jobs/elections";
import { historyJob } from "./jobs/history";
import { contextJob } from "./jobs/context";
import { opinionJob, themesJob } from "./jobs/opinion";
import { searchJob } from "./jobs/search";
import { newsJob } from "./jobs/news";
import { actorsJob } from "./jobs/actors";
import { channelsJob } from "./jobs/channels";
import { monitorJob } from "./jobs/monitor";
import { pulseJob } from "./jobs/pulse";
import { costsJob } from "./jobs/costs";

// Order matters: each job reads what the previous ones wrote.
export const JOBS: Job[] = [sourcesJob, geoJob, regimesJob, governmentsJob, partiesJob, scoresJob, deriveJob, nobelJob, thinkersJob, ideologiesJob, contextJob, electionsJob, historyJob, opinionJob, newsJob, themesJob, actorsJob, channelsJob, costsJob, monitorJob, pulseJob, searchJob];

// Named groups. The hourly pipeline (scripts/schedule.mjs) picks which run when.
export const GROUPS: Record<string, string[]> = {
  all: JOBS.map((j) => j.name),
  ideology: ["sources", "governments", "parties", "scores", "derive"],
  daily: ["sources", "regimes", "governments", "parties", "scores", "derive", "nobel", "history", "search"],
  nobel: ["nobel"],
  knowledge: ["thinkers", "ideologies", "context", "search"],
  thinkers: ["thinkers", "ideologies"],
  context: ["context", "search"],
  elections: ["elections", "history", "search"],
  opinion: ["opinion", "news", "themes", "search"],
  // Hourly: what is being said now, and the pulse computed from it.
  live: ["monitor", "pulse", "search"],
  // Weekly: who the actors and channels are.
  "monitor-setup": ["actors", "channels", "costs"],
};

export function resolveJobs(names: string[]): Job[] {
  return names
    .flatMap((a) => GROUPS[a] ?? [a])
    .map((name) => {
      const job = JOBS.find((j) => j.name === name);
      if (!job) throw new Error(`job desconhecido: ${name}`);
      return job;
    });
}
