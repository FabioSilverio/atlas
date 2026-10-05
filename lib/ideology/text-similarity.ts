const STOP = new Set("a o os as um uma de do da dos das em no na nos nas por para com e ou que se ao é foi ser são como mais não the of in on to for and or is are be that this".split(" "));

const tokens = (s: string) =>
  new Set(
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );

/** Two theses count as the same claim when their content words overlap strongly (Jaccard ≥ 0.55). */
export function similar(a: string, b: string, threshold = 0.55): boolean {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter) >= threshold;
}
