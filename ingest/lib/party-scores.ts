import { normalize } from "@/lib/ideology/normalize";
import { SOURCE_PRIORITY } from "@/lib/ideology/derive";
import { countryMatcher } from "./countries";
import { loadChesCanada, loadChesEurope, loadChesIsrael, loadChesLa, loadGps, loadParlgov, loadPartyFactsCore, loadPartyFactsExternal } from "./datasets";
import { partyFactsNameIndex } from "./partyfacts-names";
import { norm, num } from "./text";

export type BestScore = { econ: number | null; galtan: number | null; sourceId: string; year: number | null };

/**
 * Best available academic position for every Party Facts party, following the
 * same source hierarchy as governments (never averaged across sources).
 * Used for parties that are not in government: election results, legislatures.
 */
export async function loadPartyScores(): Promise<Map<number, BestScore>> {
  const [external, core, match] = await Promise.all([loadPartyFactsExternal(), loadPartyFactsCore(), countryMatcher()]);
  const pfOf = (dataset: string) => {
    const m = new Map<number, number>();
    for (const r of external) if (r.dataset_key === dataset && r.partyfacts_id) m.set(Number(r.dataset_party_id), Number(r.partyfacts_id));
    return m;
  };
  const ches = pfOf("ches");
  const parlgov = pfOf("parlgov");
  const gps = pfOf("gps");
  const pfByName = partyFactsNameIndex(core);

  const cands = new Map<number, (BestScore & { rank: number })[]>();
  const add = (pf: number | undefined, sourceId: string, year: number | null, econ: number | null, galtan: number | null) => {
    if (!pf || (econ == null && galtan == null)) return;
    const list = cands.get(pf) ?? [];
    list.push({ econ: econ == null ? null : normalize(econ, 0, 10), galtan: galtan == null ? null : normalize(galtan, 0, 10), sourceId, year, rank: SOURCE_PRIORITY.indexOf(sourceId) });
    cands.set(pf, list);
  };

  for (const r of await loadChesEurope()) add(ches.get(Number(r.party_id)), "ches-europe-2024", 2024, num(r.lrecon), num(r.galtan));
  for (const r of await loadChesCanada()) add(Number(r.partyfacts_id), "ches-canada-2023", 2023, num(r.lrecon), num(r.galtan));
  for (const r of await loadChesIsrael()) add(ches.get(Number(r.party_id)), "ches-israel-2022", 2022, num(r.lrecon), num(r.galtan));
  for (const r of await loadChesLa()) {
    const c = match(r.country_en);
    const pf = [r.party_abb, r.party, r.party_en].map((n) => pfByName.get(`${c}|${norm(n)}`)).find(Boolean);
    add(pf, "ches-la-2020", 2020, num(r.lrecon), num(r.galtan));
  }
  for (const r of await loadParlgov()) add(parlgov.get(Number(r.party_id)), "parlgov", null, num(r.state_market), num(r.liberty_authority));
  for (const r of await loadGps()) add(gps.get(Number(r.ID_GPS)) ?? (num(r.ID_PartyFacts) ?? undefined), "gps-2019", 2019, num(r.V4_Scale), num(r.V6_Scale));

  // Per dimension, the highest-ranked source that has a value.
  const out = new Map<number, BestScore>();
  for (const [pf, list] of cands) {
    const sorted = list.sort((a, b) => a.rank - b.rank);
    const e = sorted.find((s) => s.econ != null);
    const g = sorted.find((s) => s.galtan != null);
    out.set(pf, { econ: e?.econ ?? null, galtan: g?.galtan ?? null, sourceId: (e ?? g)!.sourceId, year: (e ?? g)!.year });
  }
  return out;
}
