import { parse } from "csv-parse/sync";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fetchCached, fetchJson } from "../lib/http";
import { touchSource, type Job } from "../lib/job";
import { log } from "../lib/log";
import { chunks } from "../lib/wiki";

type WbRow = { countryiso3code: string; date: string; value: number | null };
const WB = (id: string) => `https://api.worldbank.org/v2/country/all/indicator/${id}?format=json&per_page=400&mrnev=1`;

async function latest(id: string): Promise<Map<string, { value: number; year: number }>> {
  const json = await fetchJson<[unknown, WbRow[] | null]>(WB(id), { ttlHours: 24 * 7 });
  const out = new Map<string, { value: number; year: number }>();
  for (const r of json[1] ?? []) if (r.countryiso3code && r.value != null) out.set(r.countryiso3code, { value: r.value, year: Number(r.date) });
  return out;
}

/** Latest value per ISO3 code from an Our World in Data grapher CSV. */
async function owid(slug: string, column: string): Promise<Map<string, { value: number; year: number }>> {
  const csv = await fetchCached(`https://ourworldindata.org/grapher/${slug}.csv?useColumnShortNames=true`, { ttlHours: 24 * 7 });
  const out = new Map<string, { value: number; year: number }>();
  for (const r of parse(csv, { columns: true }) as Record<string, string>[]) {
    const value = Number(r[column]);
    const year = Number(r.year);
    if (!r.code || r.code.startsWith("OWID") || r[column] === "" || !Number.isFinite(value)) continue;
    const prev = out.get(r.code);
    if (!prev || year > prev.year) out.set(r.code, { value, year });
  }
  return out;
}

// World Bank series shown in the country dossier besides cost of living.
const WB_EXTRA: [indicator: string, wb: string][] = [
  ["population", "SP.POP.TOTL"],
  ["gini", "SI.POV.GINI"],
  ["unemployment", "SL.UEM.TOTL.ZS"],
  ["life_expectancy", "SP.DYN.LE00.IN"],
  ["military_spending", "MS.MIL.XPND.GD.ZS"],
  ["homicides", "VC.IHR.PSRC.P5"],
];

// Our World in Data series: [indicator, grapher slug, CSV column, source id].
const OWID_SERIES: [indicator: string, slug: string, column: string, source: string][] = [
  ["vdem_libdem", "liberal-democracy-index", "libdem_vdem__estimate_best", "vdem-indices"],
  ["vdem_freeexpr", "freedom-of-expression-index", "freeexpr_vdem__estimate_best", "vdem-indices"],
  ["hdi", "human-development-index", "hdi__sex_total", "undp-hdi"],
  ["cpi", "ti-corruption-perception-index", "cpi_score", "ti-cpi"],
];

/**
 * Cost of living per country from the World Bank (WDI):
 *  · price level: household-consumption PPP factor ÷ market exchange rate (USA = 100),
 *    i.e. what the same basket costs there in dollars;
 *  · consumer-price inflation; GDP per capita at market rates and at PPP.
 */
export const costsJob: Job = {
  name: "costs",
  description: "indicadores por país: custo de vida e sociedade (Banco Mundial), democracia (V-Dem, Freedom House), IDH e corrupção (via OWID)",
  async run() {
    const [ppp, fx, infl, gdp, gdpPpp] = await Promise.all([latest("PA.NUS.PRVT.PP"), latest("PA.NUS.FCRF"), latest("FP.CPI.TOTL.ZG"), latest("NY.GDP.PCAP.CD"), latest("NY.GDP.PCAP.PP.CD")]);
    const known = new Set(((await db.execute(sql`select code from countries`)) as unknown as { code: string }[]).map((c) => c.code.trim()));
    const rows: (typeof schema.countryIndicators.$inferInsert)[] = [];
    const add = (code: string, indicator: string, value: number, year: number, wb: string) =>
      known.has(code) && Number.isFinite(value) && rows.push({ countryCode: code, indicator, value: String(Math.round(value * 100) / 100), year, sourceId: "world-bank-wdi", sourceUrl: `https://data.worldbank.org/indicator/${wb}?locations=${code}`, updatedAt: new Date() });
    for (const [code, p] of ppp) {
      const f = fx.get(code);
      // Same year for both, or the ratio mixes two price levels.
      if (f && f.year === p.year && f.value > 0) add(code, "price_level", (p.value / f.value) * 100, p.year, "PA.NUS.PRVT.PP");
    }
    for (const [code, v] of infl) add(code, "inflation", v.value, v.year, "FP.CPI.TOTL.ZG");
    for (const [code, v] of gdp) add(code, "gdp_pc", v.value, v.year, "NY.GDP.PCAP.CD");
    for (const [code, v] of gdpPpp) add(code, "gdp_pc_ppp", v.value, v.year, "NY.GDP.PCAP.PP.CD");

    // Society, democracy and governance. Each series is optional: one failing source
    // must not wipe the cost-of-living numbers, so failures are logged and skipped.
    const optional = async <T,>(label: string, f: () => Promise<T>): Promise<T | null> => {
      try {
        return await f();
      } catch (err) {
        log.warn(`indicador ${label}: ${(err as Error).message}`);
        return null;
      }
    };
    for (const [indicator, wb] of WB_EXTRA) {
      const series = await optional(wb, () => latest(wb));
      for (const [code, v] of series ?? []) add(code, indicator, v.value, v.year, wb);
    }
    const addOwid = (code: string, indicator: string, value: number, year: number, source: string, url: string) =>
      known.has(code) && Number.isFinite(value) && rows.push({ countryCode: code, indicator, value: String(Math.round(value * 1000) / 1000), year, sourceId: source, sourceUrl: url, updatedAt: new Date() });
    for (const [indicator, slug, column, source] of OWID_SERIES) {
      const series = await optional(slug, () => owid(slug, column));
      for (const [code, v] of series ?? []) addOwid(code, indicator, v.value, v.year, source, `https://ourworldindata.org/grapher/${slug}?country=${code}`);
    }
    // Freedom House total (0–100) = political rights (0–40) + civil liberties (0–60), same year only.
    const [pr, cl] = await Promise.all([
      optional("fh-pr", () => owid("political-rights-score-fh", "polrights_score")),
      optional("fh-cl", () => owid("civil-liberties-score-fh", "civlibs_score")),
    ]);
    for (const [code, p] of pr ?? []) {
      const c = cl?.get(code);
      if (c && c.year === p.year) addOwid(code, "fh_total", p.value + c.value, p.year, "freedom-house", "https://freedomhouse.org/report/freedom-world");
    }
    await db.transaction(async (tx) => {
      await tx.delete(schema.countryIndicators);
      for (const b of chunks(rows, 500)) await tx.insert(schema.countryIndicators).values(b);
    });
    for (const s of ["world-bank-wdi", "vdem-indices", "undp-hdi", "ti-cpi", "freedom-house"]) await touchSource(s);
    return { rows: rows.length, priceLevel: rows.filter((r) => r.indicator === "price_level").length };
  },
};
