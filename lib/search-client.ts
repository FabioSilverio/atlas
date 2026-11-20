"use client";

import type { IndexRow } from "./search";

export type Hit = { kind: string; ref: string; title: string; subtitle: string | null; url: string; countryCode: string | null };

export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

let index: Promise<IndexRow[]> | null = null;

/** Loads the static index once per page view. */
export function loadIndex(): Promise<IndexRow[]> {
  index ??= fetch("/data/search.json")
    .then((r) => r.json())
    .then((j: { rows: IndexRow[] }) => j.rows)
    .catch(() => {
      index = null;
      return [];
    });
  return index;
}

/** Every word must appear; titles that start with the query rank first, then by weight (rows come sorted by weight). */
export async function searchLocal(q: string, limit = 30): Promise<Hit[]> {
  const words = fold(q).split(" ").filter((w) => w.length >= 2).slice(0, 6);
  if (!words.length) return [];
  const first = fold(q);
  const starts: Hit[] = [];
  const rest: Hit[] = [];
  for (const [kind, ref, title, subtitle, url, countryCode, , norm] of await loadIndex()) {
    if (!words.every((w) => norm.includes(w))) continue;
    const hit = { kind, ref, title, subtitle, url, countryCode };
    (norm.startsWith(first) ? starts : rest).push(hit);
    if (starts.length >= limit) break;
  }
  return [...starts, ...rest].slice(0, limit);
}
