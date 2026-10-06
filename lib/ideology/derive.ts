import type { Dimension } from "./normalize";

export type Confidence = "A" | "B" | "C" | "D";
export type Method = "expert_survey" | "manifesto" | "leader_coding" | "leader_party_proxy" | "alignment_label" | "family_label" | "editorial_estimate";

export type ScoreInput = {
  id: number;
  partyId: number | null;
  personId: number | null;
  dimension: Dimension;
  valueNorm: number;
  rawValue: number | null;
  rawLabel: string | null;
  scaleMin: number | null;
  scaleMax: number | null;
  observedYear: number | null;
  method: Method;
  sourceId: string;
  subjectName: string | null;
  notes: string | null;
};

export type DeriveInput = {
  dimension: Dimension;
  chiefPersonId: number | null;
  chiefPersonName: string | null;
  /** Parties of the chief executive, most recent membership first. */
  chiefParties: { id: number; name: string }[];
  scores: ScoreInput[];
  currentYear: number;
};

export type DerivationInput = ScoreInput & { partyName?: string | null };

export type Derivation = {
  rule: "party_of_chief_executive" | "leader_coding" | "party_proxy" | "label_estimate" | "none";
  explanation: string;
  chosen: DerivationInput | null;
  alternatives: DerivationInput[];
  caveats: string[];
};

export type DeriveResult = {
  valueNorm: number | null;
  confidence: Confidence | null;
  isEstimate: boolean;
  derivation: Derivation;
};

/** Source hierarchy (approved in the architecture review): never averaged across sources. */
export const SOURCE_PRIORITY = [
  "ches-europe-2024",
  "ches-canada-2023",
  "ches-israel-2022",
  "ches-la-2020",
  "parlgov",
  "gps-2019",
  "herre-gli",
];

export const SOURCE_SHORT: Record<string, string> = {
  "ches-europe-2024": "CHES Europa 2024",
  "ches-canada-2023": "CHES Canadá 2023",
  "ches-israel-2022": "CHES Israel 2022",
  "ches-la-2020": "CHES América Latina 2020",
  parlgov: "ParlGov",
  "gps-2019": "Global Party Survey 2019",
  "herre-gli": "Herre (2023)",
  wikidata: "Wikidata (rótulo)",
  "atlas-curation": "Curadoria ATLAS",
};

/** A recent expert survey (≤ 5 years) is A; older or time-invariant expert data is B. */
export function surveyConfidence(observedYear: number | null, currentYear: number): Confidence {
  return observedYear != null && currentYear - observedYear <= 5 ? "A" : "B";
}

const rank = (s: ScoreInput) => {
  const i = SOURCE_PRIORITY.indexOf(s.sourceId);
  return i === -1 ? SOURCE_PRIORITY.length : i;
};

const COALITION_CAVEAT =
  "Usa só o partido do chefe do executivo. A ponderação por cadeiras dos parceiros de coalizão entra na Fase 3, junto com os dados de composição parlamentar.";

export function deriveGovernmentPosition(i: DeriveInput): DeriveResult {
  const partyName = new Map(i.chiefParties.map((p) => [p.id, p.name]));
  const partyOrder = new Map(i.chiefParties.map((p, idx) => [p.id, idx]));
  const ofDim = i.scores.filter((s) => s.dimension === i.dimension);
  const withName = (s: ScoreInput): DerivationInput => ({ ...s, partyName: s.partyId ? partyName.get(s.partyId) : null });

  // 1. Expert positions of the chief executive's party.
  const party = ofDim
    .filter((s) => s.partyId != null && partyOrder.has(s.partyId) && (s.method === "expert_survey" || s.method === "manifesto"))
    // The current party wins over an old open membership; within it, the source hierarchy decides.
    .sort((a, b) => partyOrder.get(a.partyId!)! - partyOrder.get(b.partyId!)! || rank(a) - rank(b));
  if (party.length) {
    const chosen = party[0];
    const conf = surveyConfidence(chosen.observedYear, i.currentYear);
    const caveats = [COALITION_CAVEAT];
    if (i.chiefParties.length > 1)
      caveats.push(
        `O chefe do executivo tem ${i.chiefParties.length} filiações abertas no Wikidata; usamos a mais recente que tem medição acadêmica.`,
      );
    const label = SOURCE_SHORT[chosen.sourceId] ?? chosen.sourceId;
    const when = !chosen.observedYear
      ? " (média de várias ondas de surveys)"
      : label.includes(String(chosen.observedYear))
        ? ""
        : ` (${chosen.observedYear})`;
    return {
      valueNorm: chosen.valueNorm,
      confidence: conf,
      isEstimate: false,
      derivation: {
        rule: "party_of_chief_executive",
        explanation: `Posição do partido ${partyName.get(chosen.partyId!)}, do chefe do executivo, segundo ${label}${when}.`,
        chosen: withName(chosen),
        alternatives: party.slice(1).map(withName),
        caveats,
      },
    };
  }

  // 2. Categorical coding of the leader in person.
  const person = ofDim.filter((s) => s.personId != null && s.personId === i.chiefPersonId && s.method === "leader_coding");
  if (person.length) {
    const chosen = person[0];
    return {
      valueNorm: chosen.valueNorm,
      confidence: "C",
      isEstimate: false,
      derivation: {
        rule: "leader_coding",
        explanation: `${i.chiefPersonName ?? "O chefe do executivo"} foi codificado como "${chosen.rawLabel}" no eixo econômico por Herre (2023), com dado de ${chosen.observedYear}. A classificação é categórica (esquerda / centro / direita), e não uma escala contínua.`,
        chosen: withName(chosen),
        alternatives: [],
        caveats: ["Fonte única, no nível do líder, com dado anterior ao mandato atual pode ter mudado."],
      },
    };
  }

  // 3. Estimate: the party's previous leader was coded by Herre.
  const proxy = ofDim
    .filter((s) => s.partyId != null && partyOrder.has(s.partyId) && s.method === "leader_party_proxy")
    .sort((a, b) => partyOrder.get(a.partyId!)! - partyOrder.get(b.partyId!)!);
  if (proxy.length) {
    const chosen = proxy[0];
    return {
      valueNorm: chosen.valueNorm,
      confidence: "D",
      isEstimate: true,
      derivation: {
        rule: "party_proxy",
        explanation: `Estimativa. Não há survey de especialistas para o partido ${partyName.get(chosen.partyId!)}. Critério: ${chosen.notes}`,
        chosen: withName(chosen),
        alternatives: proxy.slice(1).map(withName),
        caveats: ["Supõe que o partido manteve a orientação econômica do líder anterior."],
      },
    };
  }

  // 4. Estimates from documented labels: declared alignment, then ideology family (party, then the leader).
  const labelled = [
    ...ofDim.filter((s) => s.partyId != null && partyOrder.has(s.partyId) && s.method === "alignment_label").sort((a, b) => partyOrder.get(a.partyId!)! - partyOrder.get(b.partyId!)!),
    ...ofDim.filter((s) => s.partyId != null && partyOrder.has(s.partyId) && s.method === "family_label").sort((a, b) => partyOrder.get(a.partyId!)! - partyOrder.get(b.partyId!)!),
    ...ofDim.filter((s) => s.personId != null && s.personId === i.chiefPersonId && s.method === "family_label"),
  ];
  if (labelled.length) {
    const chosen = labelled[0];
    const who = chosen.partyId ? `do partido ${partyName.get(chosen.partyId)}` : `de ${i.chiefPersonName ?? "o chefe do executivo"} (sem partido)`;
    return {
      valueNorm: chosen.valueNorm,
      confidence: "D",
      isEstimate: true,
      derivation: {
        rule: "label_estimate",
        explanation: `Estimativa: nenhuma base acadêmica mede a posição ${who}. Critério: ${chosen.notes}`,
        chosen: withName(chosen),
        alternatives: labelled.slice(1).map(withName),
        caveats: [
          chosen.method === "alignment_label"
            ? "Rótulo editorial do Wikidata, não medição; serve para situar o governo até haver survey."
            : "Posição típica da família ideológica, não do partido em si.",
        ],
      },
    };
  }

  // 5. Nothing usable: say exactly why.
  let why: string;
  if (!i.chiefParties.length)
    why = `${i.chiefPersonName ?? "O chefe do executivo"} não tem filiação partidária registrada no Wikidata (independente, monarca, militar ou dado ausente), e não há codificação individual em Herre (2023).`;
  else if (!ofDim.some((s) => s.partyId != null))
    why = `Nenhuma das fontes acadêmicas cobre o partido ${i.chiefParties.map((p) => p.name).join(" / ")}${
      i.dimension === "galtan" ? " neste eixo" : ""
    }.`;
  else why = "Há scores para o partido, mas não neste eixo.";
  return {
    valueNorm: null,
    confidence: null,
    isEstimate: false,
    derivation: { rule: "none", explanation: why, chosen: null, alternatives: [], caveats: [] },
  };
}
