// Deterministic, documented mappings used only for confidence-D estimates when no
// academic survey covers a party. Never used when a survey score exists.

/** Wikidata P1387 "political alignment" (English label) → general left–right value. */
export function alignmentValue(label: string): number | null {
  const l = label.toLowerCase();
  if (/far-left|far left|ultra-left|radical left/.test(l)) return -0.85;
  if (/far-right|far right|right-wing extremism|alt-right|ultranational|radical right/.test(l)) return 0.85;
  if (/centre-left|center-left/.test(l)) return -0.3;
  if (/centre-right|center-right/.test(l)) return 0.3;
  if (/left-wing|^left/.test(l)) return -0.6;
  if (/right-wing|^right|right-libertarian/.test(l)) return 0.6;
  if (/centrism|centre|center|radical centre/.test(l)) return 0;
  return null; // big tent, syncretic, catch-all…
}

/** Mean of the mapped values; null when none of the labels maps. */
export function alignmentEstimate(labels: string[]): { value: number; used: string[] } | null {
  const used = labels.filter((l) => alignmentValue(l) != null);
  if (!used.length) return null;
  const value = used.reduce((a, l) => a + alignmentValue(l)!, 0) / used.length;
  return { value: Math.round(value * 1000) / 1000, used };
}

// ParlGov party families (family_name_short) and the ideology labels that point to them.
// Order matters: the most specific family wins.
export const FAMILY_RULES: [string, RegExp][] = [
  ["com", /\b(communism|marxism|leninism|maoism|trotskyism|juche|anti-capitalism)\b/i],
  ["eco", /\b(green politics|environmentalism|eco-socialism|ecologism)\b/i],
  ["right", /\b(right-wing populism|far-right|ultranationalism|national conservatism|nativism|anti-immigration|opposition to immigration|euroscepticism|hindutva|national populism)\b/i],
  ["chr", /\b(christian democracy|christian right|catholic social teaching)\b/i],
  ["con", /\b(conservatism|liberal conservatism|social conservatism|traditionalism|monarchism)\b/i],
  ["soc", /\b(social democracy|democratic socialism|socialism|labourism|labour|left-wing populism|progressivism|pan-africanism|bolivarianism|peronism|kemalism)\b/i],
  ["agr", /\b(agrarianism|ruralism)\b/i],
  ["lib", /\b(liberalism|classical liberalism|social liberalism|economic liberalism|neoliberalism|libertarianism|liberal democracy|centrism)\b/i],
];

export function familyOf(labels: string[]): { family: string; matched: string } | null {
  for (const [family, re] of FAMILY_RULES) {
    const hit = labels.find((l) => re.test(l));
    if (hit) return { family, matched: hit };
  }
  return null;
}

export const FAMILY_NAME: Record<string, string> = {
  com: "comunista/esquerda radical",
  eco: "verde",
  soc: "social-democrata/socialista",
  lib: "liberal",
  chr: "democrata-cristã",
  con: "conservadora",
  right: "direita radical/populista",
  agr: "agrária",
};
