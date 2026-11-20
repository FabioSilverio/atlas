/** Lowercase, accent-free, any script; punctuation becomes spaces. */
export const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Google News national editions: ISO2 → [hl, ceid, local word for "politics"].
// Countries without an edition are covered by an English search about them.
export const GNEWS_EDITIONS: Record<string, [string, string, string]> = {
  AR: ["es-419", "AR:es-419", "política"], AT: ["de", "AT:de", "Politik"], AU: ["en-AU", "AU:en", "politics"], BD: ["bn", "BD:bn", "রাজনীতি"],
  BE: ["fr", "BE:fr", "politique"], BG: ["bg", "BG:bg", "политика"], BR: ["pt-BR", "BR:pt-419", "política"], BW: ["en", "BW:en", "politics"],
  CA: ["en-CA", "CA:en", "politics"], CH: ["de", "CH:de", "Politik"], CL: ["es-419", "CL:es-419", "política"], CN: ["zh-CN", "CN:zh-Hans", "政治"],
  CO: ["es-419", "CO:es-419", "política"], CU: ["es-419", "CU:es-419", "política"], CZ: ["cs", "CZ:cs", "politika"], DE: ["de", "DE:de", "Politik"],
  EG: ["ar", "EG:ar", "سياسة"], ES: ["es", "ES:es", "política"], ET: ["en", "ET:en", "politics"], FR: ["fr", "FR:fr", "politique"],
  GB: ["en-GB", "GB:en", "politics"], GH: ["en", "GH:en", "politics"], GR: ["el", "GR:el", "πολιτική"], HK: ["zh-HK", "HK:zh-Hant", "政治"],
  HU: ["hu", "HU:hu", "politika"], ID: ["id", "ID:id", "politik"], IE: ["en-IE", "IE:en", "politics"], IL: ["he", "IL:he", "פוליטיקה"],
  IN: ["en-IN", "IN:en", "politics"], IT: ["it", "IT:it", "politica"], JP: ["ja", "JP:ja", "政治"], KE: ["en", "KE:en", "politics"],
  KR: ["ko", "KR:ko", "정치"], LB: ["ar", "LB:ar", "سياسة"], LT: ["lt", "LT:lt", "politika"], LV: ["lv", "LV:lv", "politika"],
  MA: ["fr", "MA:fr", "politique"], MX: ["es-419", "MX:es-419", "política"], MY: ["en-MY", "MY:en", "politics"], NA: ["en", "NA:en", "politics"],
  NG: ["en", "NG:en", "politics"], NL: ["nl", "NL:nl", "politiek"], NO: ["no", "NO:no", "politikk"], NZ: ["en-NZ", "NZ:en", "politics"],
  PE: ["es-419", "PE:es-419", "política"], PH: ["en-PH", "PH:en", "politics"], PK: ["en", "PK:en", "politics"], PL: ["pl", "PL:pl", "polityka"],
  PT: ["pt-PT", "PT:pt-150", "política"], RO: ["ro", "RO:ro", "politică"], RS: ["sr", "RS:sr", "политика"], RU: ["ru", "RU:ru", "политика"],
  SA: ["ar", "SA:ar", "سياسة"], SE: ["sv", "SE:sv", "politik"], SG: ["en-SG", "SG:en", "politics"], SI: ["sl", "SI:sl", "politika"],
  SK: ["sk", "SK:sk", "politika"], SN: ["fr", "SN:fr", "politique"], TH: ["th", "TH:th", "การเมือง"], TR: ["tr", "TR:tr", "siyaset"],
  TW: ["zh-TW", "TW:zh-Hant", "政治"], TZ: ["en", "TZ:en", "politics"], UA: ["uk", "UA:uk", "політика"], AE: ["ar", "AE:ar", "سياسة"],
  UG: ["en", "UG:en", "politics"], US: ["en-US", "US:en", "politics"], VE: ["es-419", "VE:es-419", "política"], VN: ["vi", "VN:vi", "chính trị"],
  ZA: ["en", "ZA:en", "politics"], ZW: ["en", "ZW:en", "politics"],
};

/** Wikidata label languages worth matching for a country (edition language + English). */
export function countryLangs(iso2: string | null): string[] {
  const ed = iso2 ? GNEWS_EDITIONS[iso2] : undefined;
  const lang = ed ? ed[0].split("-")[0] : null;
  return [...new Set([lang, "en", "mul"].filter(Boolean) as string[])];
}

// Side thresholds on the -1…+1 economic left-right scale.
export const SIDE_CUT = 0.15;
export type Side = "left" | "center" | "right";
export const sideOf = (econ: number): Side => (econ <= -SIDE_CUT ? "left" : econ >= SIDE_CUT ? "right" : "center");

// ── Matching actors in titles ───────────────────────────────────

export type ActorRef = { id: number; name: string; aliases: string[]; econ: number | null; partyLabel: string | null };
type Matcher = { find: (title: string) => ActorRef[] };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Builds a matcher for one country's actors. Acronyms (PT, PL, AfD) must appear
 * exactly as written, as a whole word; the rest match case- and accent-insensitively
 * on word boundaries.
 */
export function actorMatcher(actors: ActorRef[]): Matcher {
  const short: { re: RegExp; a: ActorRef }[] = [];
  const long = new Map<string, ActorRef[]>();
  for (const a of actors)
    for (const al of a.aliases) {
      // "=Word": a one-word name that is also an ordinary word; capitalised and not the first word.
      if (al.startsWith("=")) short.push({ re: new RegExp(`(?<=[^\\p{L}\\p{N}])${esc(al.slice(1))}(?![\\p{L}\\p{N}])`, "u"), a });
      // Acronyms keep their capitals (folded aliases are lower-case).
      else if (al !== al.toLowerCase()) short.push({ re: new RegExp(`(^|[^\\p{L}\\p{N}])${esc(al)}($|[^\\p{L}\\p{N}])`, "u"), a });
      else long.set(al, [...(long.get(al) ?? []), a]);
    }
  const longRe = long.size
    ? new RegExp(`(?:^| )(${[...long.keys()].sort((x, y) => y.length - x.length).map(esc).join("|")})(?= |$)`, "g")
    : null;
  return {
    find(title) {
      const hits = new Map<number, ActorRef>();
      for (const s of short) if (s.re.test(title)) hits.set(s.a.id, s.a);
      if (longRe) {
        const n = ` ${fold(title)} `;
        for (const m of n.matchAll(longRe)) for (const a of long.get(m[1]) ?? []) hits.set(a.id, a);
      }
      return [...hits.values()];
    },
  };
}

/** Mean position of the mentioned actors that have one, and a readable basis. */
export function leanOf(hits: ActorRef[]): { econ: number | null; basis: string | null } {
  const scored = hits.filter((h) => h.econ != null);
  if (!scored.length) return { econ: null, basis: null };
  const econ = scored.reduce((s, h) => s + h.econ!, 0) / scored.length;
  return { econ: Math.round(econ * 1000) / 1000, basis: `menciona ${scored.map((h) => h.name).slice(0, 4).join(", ")}` };
}

/** Item weight from its public metric: log-scaled so one viral video does not erase everything else. */
export function weightOf(platform: string, metric: number | null): number {
  if (platform === "news") return 1;
  if (metric == null || metric <= 0) return 1;
  return Math.max(1, Math.log10(metric + 1));
}

export function youtubeId(url: string): string | null {
  return url.match(/[?&]v=([\w-]{11})/)?.[1] ?? url.match(/youtu\.be\/([\w-]{11})/)?.[1] ?? null;
}
