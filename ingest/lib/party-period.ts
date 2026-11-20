// Party Facts often points two parties at one English Wikipedia article: a defunct party and
// the current one that took its name (Brazil's Partido Liberal of 1985–2006 and today's PL,
// the former Partido da República). Matching election results by article alone then gives a
// 2026 result the score of a party that ended in 2006 — usually none at all. This picks the
// namesake that was active in the election year instead.

export type CoreParty = { partyfacts_id: string; country: string; name_short?: string; name?: string; name_english?: string; name_other?: string; year_first?: string; year_last?: string };

const names = (p: CoreParty) =>
  new Set(
    [p.name_short, p.name, p.name_english, p.name_other]
      .flatMap((v) => (v ?? "").split(/\s*[\/;|]\s*/))
      .map((v) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s*\(.*\)$/, "").trim())
      .filter((v) => v.length >= 2),
  );

const active = (p: CoreParty, year: number) => {
  const first = Number(p.year_first) || -Infinity;
  const last = Number(p.year_last) || Infinity;
  return first <= year && year <= last;
};

export function partyPeriodIndex(core: CoreParty[]) {
  const byId = new Map(core.map((p) => [Number(p.partyfacts_id), p]));
  const byCountry = new Map<string, CoreParty[]>();
  for (const p of core) byCountry.set(p.country, [...(byCountry.get(p.country) ?? []), p]);

  /**
   * The Party Facts id to use for a result in `year`: the matched id when that party was
   * active (or its dates are unknown), else an active namesake in the same country — one
   * with an academic score first. Returns the original id when there is no better choice.
   */
  return function activeNamesake(pf: number, year: number, hasScore: (pf: number) => boolean): number {
    const p = byId.get(pf);
    if (!p || active(p, year)) return pf;
    const own = names(p);
    const twins = (byCountry.get(p.country) ?? []).filter((q) => q !== p && active(q, year) && [...names(q)].some((n) => own.has(n)));
    const best = twins.find((q) => hasScore(Number(q.partyfacts_id))) ?? (twins.length === 1 ? twins[0] : undefined);
    return best ? Number(best.partyfacts_id) : pf;
  };
}
