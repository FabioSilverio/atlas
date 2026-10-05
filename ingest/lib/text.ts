/** Lowercase, strip accents and punctuation; used for cross-dataset name matching. */
export function norm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Canonical key for an English Wikipedia article URL or title. */
export function wikiKey(urlOrTitle: string | null | undefined): string | null {
  if (!urlOrTitle) return null;
  let t = urlOrTitle.replace(/^https?:\/\/en\.(m\.)?wikipedia\.org\/wiki\//, "");
  try {
    t = decodeURIComponent(t);
  } catch {}
  t = t.replace(/#.*$/, "").replace(/ /g, "_").trim();
  return t ? t.toLowerCase() : null;
}

export const num = (s: string | undefined | null): number | null => {
  if (s == null || s === "" || s === "NA" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** All tokens (≥ 3 letters) of the source's name appear in the Wikidata name. */
export function sameLeader(sourceName: string, wikidataName: string): boolean {
  const want = norm(sourceName).split(" ").filter((t) => t.length >= 3);
  const have = new Set(norm(wikidataName).split(" "));
  return want.length > 0 && want.every((t) => have.has(t));
}
