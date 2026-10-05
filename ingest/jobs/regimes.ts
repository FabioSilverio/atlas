import { parse } from "csv-parse/sync";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fetchCached } from "../lib/http";
import { touchSource, type Job } from "../lib/job";

const URL = "https://ourworldindata.org/grapher/political-regime.csv";
const LABELS = ["closed_autocracy", "electoral_autocracy", "electoral_democracy", "liberal_democracy"];

export const regimesJob: Job = {
  name: "regimes",
  description: "V-Dem Regimes of the World (via OWID) → countries.regime_type",
  async run() {
    const csv = await fetchCached(URL, { ttlHours: 24 * 7 });
    const rows = parse(csv, { columns: true }) as Record<string, string>[];
    const latest = new Map<string, { year: number; value: number }>();
    for (const r of rows) {
      if (!r.Code || r.Code.startsWith("OWID")) continue;
      const year = Number(r.Year);
      const value = Number(r["Political regime"]);
      if (!Number.isFinite(value)) continue;
      const prev = latest.get(r.Code);
      if (!prev || year > prev.year) latest.set(r.Code, { year, value });
    }
    const countries = await db.select({ code: schema.countries.code }).from(schema.countries);
    let n = 0;
    for (const { code } of countries) {
      const hit = latest.get(code);
      if (!hit) continue;
      await db
        .update(schema.countries)
        .set({ regimeType: LABELS[hit.value], regimeYear: hit.year, regimeSourceId: "vdem-row" })
        .where(eq(schema.countries.code, code));
      n++;
    }
    await touchSource("vdem-row");
    return { countriesWithRegime: n };
  },
};
