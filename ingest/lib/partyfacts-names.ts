import { norm } from "./text";

type CoreRow = Record<string, string>;

/**
 * Country + name/abbreviation → Party Facts id. Splits compound entries
 * ("PR/PL", "Partido da República / Partido Liberal") and, when a name is
 * shared, prefers parties still active (no end year, or ending after 2010)
 * over historical namesakes (e.g. Brazil's PR of 1945–65).
 */
export function partyFactsNameIndex(core: CoreRow[]): Map<string, number> {
  const best = new Map<string, { id: number; active: boolean; first: number }>();
  for (const r of core) {
    const id = Number(r.partyfacts_id);
    const last = Number(r.year_last) || null;
    const active = last == null || last >= 2010;
    const first = Number(r.year_first) || 0;
    const names = [r.name_short, r.name, r.name_english, ...(r.name_other ?? "").split("/").map((s) => s.replace(/^[^:]+:\s*/, ""))]
      .flatMap((n) => (n ?? "").split(/\s*\/\s*/))
      .map((n) => norm(n))
      .filter((n) => n.length >= 2);
    for (const n of new Set(names)) {
      const key = `${r.country}|${n}`;
      const prev = best.get(key);
      // Active beats historical; among equals, the most recently founded wins.
      if (!prev || (active && !prev.active) || (active === prev.active && first > prev.first)) best.set(key, { id, active, first });
    }
  }
  return new Map([...best].map(([k, v]) => [k, v.id]));
}
