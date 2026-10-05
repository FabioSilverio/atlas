export const REGIME_LABEL: Record<string, string> = {
  closed_autocracy: "Autocracia fechada",
  electoral_autocracy: "Autocracia eleitoral",
  electoral_democracy: "Democracia eleitoral",
  liberal_democracy: "Democracia liberal",
};

export const NOBEL_CATEGORY: Record<string, string> = {
  phy: "Física",
  che: "Química",
  med: "Medicina",
  lit: "Literatura",
  pea: "Paz",
  eco: "Economia",
};

export const NOBEL_RELATION: Record<string, string> = {
  birth: "nascimento",
  org_seat: "sede",
  affiliation: "afiliação",
};

export const ROLE_LABEL = { head_of_state: "Chefe de Estado", head_of_government: "Chefe de governo" } as const;

export const EVENT_LABEL: Record<string, string> = {
  government_change: "GOVERNO",
  nobel_awarded: "NOBEL",
  election_held: "ELEIÇÃO",
  theme_rising: "TEMA",
  thesis_rising: "TESE",
  column_published: "COLUNA",
};

export type LayerId = "econ" | "galtan" | "elections" | "thinkers" | "nobel" | "themes";
export const LAYER_IDS: LayerId[] = ["econ", "galtan", "elections", "thinkers", "nobel", "themes"];
export const LAYERS: { id: LayerId; label: string; group: string }[] = [
  { id: "econ", label: "Eixo econômico", group: "Ideologia do governo atual" },
  { id: "galtan", label: "Eixo cultural (GAL–TAN)", group: "Ideologia do governo atual" },
  { id: "elections", label: "Eleições recentes (deriva)", group: "Eleições" },
  { id: "thinkers", label: "Densidade de pensadores", group: "Ideias e conhecimento" },
  { id: "nobel", label: "Nobel por país", group: "Ideias e conhecimento" },
  { id: "themes", label: "Debate de opinião", group: "Ideias e conhecimento" },
];

export const fmtDate = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("pt-BR", { timeZone: "UTC", ...opts }).replace(/\./g, "") : "—";

export const fmtNorm = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`);

export function sideLabel(v: number | null | undefined, dim: "econ_lr" | "galtan") {
  if (v == null) return "sem dado";
  // Descriptive position on the scale only, never a label like "extreme right":
  // that is an editorial judgement the data does not make.
  const a = Math.abs(v);
  if (a < 0.15) return "centro";
  if (dim === "econ_lr") {
    const side = v < 0 ? "esquerda" : "direita";
    return a < 0.45 ? `centro-${side}` : a < 0.75 ? side : `${side} (polo da escala)`;
  }
  const side = v < 0 ? "libertário/progressista" : "autoritário/tradicionalista";
  return a < 0.45 ? `moderadamente ${side}` : a < 0.75 ? side : `${side} (polo da escala)`;
}

// UN M49 subregions as used by Natural Earth.
export const SUBREGION_PT: Record<string, string> = {
  "Northern Africa": "Norte da África",
  "Eastern Africa": "África Oriental",
  "Middle Africa": "África Central",
  "Southern Africa": "África Austral",
  "Western Africa": "África Ocidental",
  Caribbean: "Caribe",
  "Central America": "América Central",
  "South America": "América do Sul",
  "Northern America": "América do Norte",
  "Central Asia": "Ásia Central",
  "Eastern Asia": "Ásia Oriental",
  "South-Eastern Asia": "Sudeste Asiático",
  "Southern Asia": "Sul da Ásia",
  "Western Asia": "Ásia Ocidental",
  "Eastern Europe": "Europa Oriental",
  "Northern Europe": "Europa Setentrional",
  "Southern Europe": "Europa Meridional",
  "Western Europe": "Europa Ocidental",
  "Australia and New Zealand": "Austrália e Nova Zelândia",
  Melanesia: "Melanésia",
  Micronesia: "Micronésia",
  Polynesia: "Polinésia",
  Antarctica: "Antártida",
  "Seven seas (open ocean)": "Oceano aberto",
};
export const subregionPt = (s: string | null) => (s ? (SUBREGION_PT[s] ?? s) : null);
