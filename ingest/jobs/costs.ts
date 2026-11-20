import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fetchJson } from "../lib/http";
import { touchSource, type Job } from "../lib/job";
import { chunks } from "../lib/wiki";

type WbRow = { countryiso3code: string; date: string; value: number | null };
const WB = (id: string) => `https://api.worldbank.org/v2/country/all/indicator/${id}?format=json&per_page=400&mrnev=1`;

async function latest(id: string): Promise<Map<string, { value: number; year: number }>> {
  const json = await fetchJson<[unknown, WbRow[] | null]>(WB(id), { ttlHours: 24 * 7 });
  const out = new Map<string, { value: number; year: number }>();
  for (const r of json[1] ?? []) if (r.countryiso3code && r.value != null) out.set(r.countryiso3code, { value: r.value, year: Number(r.date) });
  return out;
}

/**
 * Cost of living per country from the World Bank (WDI):
 *  · price level: household-consumption PPP factor ÷ market exchange rate (USA = 100),
 *    i.e. what the same basket costs there in dollars;
 *  · consumer-price inflation; GDP per capita at market rates and at PPP.
 */
export const costsJob: Job = {
  name: "costs",
  description: "custo de vida por país: nível de preços (EUA = 100), inflação e renda (Banco Mundial)",
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
    await db.transaction(async (tx) => {
      await tx.delete(schema.countryIndicators);
      for (const b of chunks(rows, 500)) await tx.insert(schema.countryIndicators).values(b);
    });
    await touchSource("world-bank-wdi");
    return { rows: rows.length, priceLevel: rows.filter((r) => r.indicator === "price_level").length };
  },
};
