import { fetchJson } from "./http";

export const chunks = <T,>(arr: T[], size: number): T[][] => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** Lead paragraphs (plain text) for Wikipedia articles; returns title → {extract, url}. */
export async function wikiExtracts(lang: "pt" | "en", titles: string[], sentences = 3): Promise<Map<string, { extract: string; url: string }>> {
  const out = new Map<string, { extract: string; url: string }>();
  for (const batch of chunks([...new Set(titles)], 20)) {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=extracts&exintro=1&explaintext=1&exsentences=${sentences}&redirects=1&titles=${encodeURIComponent(batch.join("|"))}`;
    type R = { query?: { pages?: { title: string; extract?: string; missing?: boolean }[]; redirects?: { from: string; to: string }[]; normalized?: { from: string; to: string }[] } };
    const json = await fetchJson<R>(url, { ttlHours: 24 * 30 });
    const alias = new Map<string, string>();
    for (const n of json.query?.normalized ?? []) alias.set(n.to, n.from);
    for (const r of json.query?.redirects ?? []) alias.set(r.to, alias.get(r.from) ?? r.from);
    for (const p of json.query?.pages ?? []) {
      if (p.missing || !p.extract) continue;
      const original = alias.get(p.title) ?? p.title;
      const value = { extract: p.extract.trim(), url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}` };
      out.set(original, value);
      out.set(p.title, value);
    }
  }
  return out;
}

/** Commons thumbnails with attribution and license, keyed by file name. */
export async function commonsInfo(files: string[], width = 240): Promise<Map<string, { thumb: string; artist: string | null; license: string | null; page: string }>> {
  const out = new Map<string, { thumb: string; artist: string | null; license: string | null; page: string }>();
  for (const batch of chunks([...new Set(files)], 40)) {
    const titles = batch.map((f) => `File:${f}`).join("|");
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=${width}&iiextmetadatafilter=Artist|LicenseShortName&titles=${encodeURIComponent(titles)}`;
    type R = {
      query?: {
        pages?: { title: string; imageinfo?: { thumburl?: string; descriptionurl?: string; extmetadata?: Record<string, { value: string }> }[] }[];
        normalized?: { from: string; to: string }[];
      };
    };
    const json = await fetchJson<R>(url, { ttlHours: 24 * 30 });
    const alias = new Map((json.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of json.query?.pages ?? []) {
      const ii = p.imageinfo?.[0];
      if (!ii?.thumburl) continue;
      const name = (alias.get(p.title) ?? p.title).replace(/^File:/, "");
      out.set(name, {
        thumb: ii.thumburl,
        artist: ii.extmetadata?.Artist ? stripTags(ii.extmetadata.Artist.value).slice(0, 200) : null,
        license: ii.extmetadata?.LicenseShortName?.value ?? null,
        page: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
      });
    }
  }
  return out;
}

/** "https://xx.wikipedia.org/wiki/Foo_bar" → "Foo bar". */
export const wikiTitle = (url: string) => decodeURIComponent(url.split("/wiki/")[1] ?? "").replace(/_/g, " ");
