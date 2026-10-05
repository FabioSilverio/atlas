import type { Confidence } from "@/lib/ideology/derive";

export type RGB = [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
export const css = (c: RGB, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// Diverging, stepped for the dark surface: lightness rises from the gray
// midpoint toward both poles (OKLCH L ≈ 0.42 → 0.62 → 0.78). Violet ↔ copper
// instead of blue ↔ red on purpose: red means "left" in Brazil and "right" in
// the US, so partisan colours would invert the reading depending on the reader.
// Poles validated for colour-vision deficiency: ΔE 21 (protan), 16 (tritan).
export const DIVERGING_STOPS: [number, string][] = [
  [-1, "#b3a8f5"],
  [-0.5, "#7f6fd6"],
  [0, "#4a4c55"],
  [0.5, "#cf6e33"],
  [1, "#ff9f5e"],
];
const STOPS = DIVERGING_STOPS.map(([v, h]) => [v, hex(h)] as const);

export function divergingColor(v: number): RGB {
  const x = Math.max(-1, Math.min(1, v));
  for (let i = 1; i < STOPS.length; i++) {
    const [v1, c1] = STOPS[i];
    if (x <= v1) {
      const [v0, c0] = STOPS[i - 1];
      return mix(c0, c1, (x - v0) / (v1 - v0));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

// Sequential (one hue, blue), anchored dark → light on the dark surface.
const SEQ = ["#104281", "#1c5cab", "#2a78d6", "#5598e7", "#86b6ef", "#b7d3f6"].map(hex);
export const NOBEL_BREAKS = [1, 3, 10, 30, 100, 300];
export const THINKER_BREAKS = [1, 3, 6, 12, 24, 40];
export const OPINION_BREAKS = [1, 10, 30, 100, 300, 1000];
export function sequentialColor(count: number, breaks: number[] = NOBEL_BREAKS): RGB | null {
  if (count <= 0) return null;
  let i = breaks.findIndex((b) => count < b) - 1;
  if (i < 0) i = SEQ.length - 1;
  return SEQ[Math.max(0, Math.min(SEQ.length - 1, i))];
}
export const sequentialLegend = (breaks: number[]) => breaks.map((b, i) => ({ from: b, color: css(SEQ[i]) }));
export const NOBEL_LEGEND = sequentialLegend(NOBEL_BREAKS);
/** Drift between consecutive elections is small; ±0.25 on the −1…+1 scale saturates the colour. */
export const DRIFT_SCALE = 0.25;

export const NO_DATA: RGB = hex("#1b2129");
export const NO_GOV: RGB = hex("#12171d");

/** Opacity encodes confidence; D (estimate) and missing data also get a hatch. */
export const CONFIDENCE_ALPHA: Record<Confidence, number> = { A: 1, B: 0.86, C: 0.66, D: 0.5 };

export const CONFIDENCE_TEXT: Record<Confidence, { label: string; long: string }> = {
  A: { label: "A", long: "Survey de especialistas ou manifesto no nível do partido, dado de até 5 anos." },
  B: { label: "B", long: "Survey de especialistas no nível do partido com dado de mais de 5 anos, ou média atemporal (ParlGov)." },
  C: { label: "C", long: "Codificação categórica do líder (Herre, 2023), fonte única." },
  D: { label: "D", long: "Estimativa: critério explícito, sem medição direta do partido ou do líder atual." },
};
