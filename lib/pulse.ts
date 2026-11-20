import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { Pulse } from "@/lib/db/schema";

export type CountryPulse = { code: string; computedAt: string; data: Pulse; history: { day: string; left: number; right: number; mean: number | null; n: number }[] };
export type CountryCost = { priceLevel: number | null; inflation: number | null; gdpPc: number | null; gdpPcPpp: number | null; year: number | null; sources: Record<string, string> };

const rows = async <T,>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

export async function getPulse(code: string): Promise<CountryPulse | null> {
  const [p] = await rows<{ data: Pulse; computed_at: string }>(sql`select data, computed_at from pulse where country_code = ${code}`);
  if (!p) return null;
  const history = await rows<{ day: string; left: string; right: string; mean: string | null; n: number }>(sql`
    select day::text, "left", "right", mean, n from pulse_history where country_code = ${code} and day > now() - interval '60 days' order by day`);
  return {
    code,
    computedAt: new Date(p.computed_at).toISOString(),
    data: p.data,
    history: history.map((h) => ({ day: h.day, left: Number(h.left), right: Number(h.right), mean: h.mean == null ? null : Number(h.mean), n: h.n })),
  };
}

export async function getCountryCost(code: string): Promise<CountryCost | null> {
  const r = await rows<{ indicator: string; value: string; year: number; source_url: string }>(sql`select indicator, value, year, source_url from country_indicators where country_code = ${code}`);
  if (!r.length) return null;
  const v = (k: string) => r.find((x) => x.indicator === k);
  const n = (k: string) => (v(k) ? Number(v(k)!.value) : null);
  return { priceLevel: n("price_level"), inflation: n("inflation"), gdpPc: n("gdp_pc"), gdpPcPpp: n("gdp_pc_ppp"), year: v("price_level")?.year ?? v("gdp_pc")?.year ?? null, sources: Object.fromEntries(r.map((x) => [x.indicator, x.source_url])) };
}
