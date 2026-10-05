export type Dimension = "econ_lr" | "galtan" | "general_lr";

/** Linear map of a bounded scale onto [-1, +1]; -1 = left / libertarian, +1 = right / authoritarian. */
export function normalize(raw: number, min: number, max: number): number {
  if (!(max > min)) throw new Error(`escala inválida [${min}, ${max}]`);
  const clamped = Math.min(max, Math.max(min, raw));
  return Math.round((((clamped - min) / (max - min)) * 2 - 1) * 1000) / 1000;
}

// Herre (2023) codes leaders' economic ideology categorically. We place the
// categories at the middle of each third of the scale; this is a display
// convention, flagged as categorical in the dossier, not a measurement.
export const HERRE_CATEGORY_VALUE: Record<string, number> = {
  leftist: -0.6,
  centrist: 0,
  rightist: 0.6,
};

export const DIMENSION_LABEL: Record<Dimension, { name: string; low: string; high: string }> = {
  econ_lr: { name: "Eixo econômico", low: "Esquerda (Estado)", high: "Direita (mercado)" },
  galtan: { name: "Eixo cultural", low: "Libertário / progressista", high: "Autoritário / tradicionalista" },
  general_lr: { name: "Esquerda–direita geral", low: "Esquerda", high: "Direita" },
};
