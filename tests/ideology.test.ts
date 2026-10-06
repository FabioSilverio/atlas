import { describe, expect, it } from "vitest";
import { chooseChiefExecutive } from "@/lib/ideology/chief-executive";
import { deriveGovernmentPosition, surveyConfidence, type ScoreInput } from "@/lib/ideology/derive";
import { normalize } from "@/lib/ideology/normalize";
import { sameLeader } from "@/ingest/lib/text";

const score = (o: Partial<ScoreInput>): ScoreInput => ({
  id: 1,
  partyId: 10,
  personId: null,
  dimension: "econ_lr",
  valueNorm: 0,
  rawValue: 5,
  rawLabel: null,
  scaleMin: 0,
  scaleMax: 10,
  observedYear: 2024,
  method: "expert_survey",
  sourceId: "ches-europe-2024",
  subjectName: "X",
  notes: null,
  ...o,
});

const base = {
  dimension: "econ_lr" as const,
  chiefPersonId: 7,
  chiefPersonName: "Fulano",
  chiefParties: [{ id: 10, name: "Partido A" }],
  currentYear: 2026,
};

describe("normalize", () => {
  it("maps 0–10 onto -1…+1", () => {
    expect(normalize(0, 0, 10)).toBe(-1);
    expect(normalize(5, 0, 10)).toBe(0);
    expect(normalize(10, 0, 10)).toBe(1);
    expect(normalize(7.5, 0, 10)).toBe(0.5);
  });
  it("clamps out-of-range values", () => {
    expect(normalize(12, 0, 10)).toBe(1);
  });
  it("rejects a degenerate scale", () => {
    expect(() => normalize(1, 5, 5)).toThrow();
  });
});

describe("surveyConfidence", () => {
  it("A for data up to 5 years old, B otherwise or when undated", () => {
    expect(surveyConfidence(2021, 2026)).toBe("A");
    expect(surveyConfidence(2020, 2026)).toBe("B");
    expect(surveyConfidence(null, 2026)).toBe("B");
  });
});

describe("deriveGovernmentPosition", () => {
  it("follows the source hierarchy instead of averaging", () => {
    const r = deriveGovernmentPosition({
      ...base,
      scores: [
        score({ id: 1, sourceId: "gps-2019", valueNorm: -0.8, observedYear: 2019 }),
        score({ id: 2, sourceId: "ches-europe-2024", valueNorm: 0.4 }),
        score({ id: 3, sourceId: "parlgov", valueNorm: 0.1, observedYear: null }),
      ],
    });
    expect(r.valueNorm).toBe(0.4);
    expect(r.confidence).toBe("A");
    expect(r.derivation.chosen?.id).toBe(2);
    expect(r.derivation.alternatives.map((a) => a.id)).toEqual([3, 1]);
  });

  it("downgrades old surveys to B", () => {
    const r = deriveGovernmentPosition({ ...base, scores: [score({ sourceId: "gps-2019", observedYear: 2019 })] });
    expect(r.confidence).toBe("B");
  });

  it("falls back to the leader's own coding (C) when the party has no survey", () => {
    const r = deriveGovernmentPosition({
      ...base,
      scores: [score({ partyId: null, personId: 7, method: "leader_coding", sourceId: "herre-gli", rawLabel: "rightist", valueNorm: 0.6, observedYear: 2020 })],
    });
    expect(r.confidence).toBe("C");
    expect(r.isEstimate).toBe(false);
    expect(r.valueNorm).toBe(0.6);
  });

  it("ignores a leader coding that belongs to someone else", () => {
    const r = deriveGovernmentPosition({
      ...base,
      scores: [score({ partyId: null, personId: 99, method: "leader_coding", sourceId: "herre-gli" })],
    });
    expect(r.valueNorm).toBeNull();
  });

  it("marks the party proxy as an estimate (D)", () => {
    const r = deriveGovernmentPosition({
      ...base,
      scores: [score({ method: "leader_party_proxy", sourceId: "herre-gli", valueNorm: -0.6, notes: "critério" })],
    });
    expect(r.confidence).toBe("D");
    expect(r.isEstimate).toBe(true);
  });

  it("explains why there is no data", () => {
    const noParty = deriveGovernmentPosition({ ...base, chiefParties: [], scores: [] });
    expect(noParty.valueNorm).toBeNull();
    expect(noParty.derivation.explanation).toMatch(/filiação partidária/);

    const uncovered = deriveGovernmentPosition({ ...base, scores: [] });
    expect(uncovered.derivation.explanation).toMatch(/Nenhuma das fontes/);
  });

  it("does not use a score from another dimension", () => {
    const r = deriveGovernmentPosition({ ...base, dimension: "galtan", scores: [score({ dimension: "econ_lr" })] });
    expect(r.valueNorm).toBeNull();
  });
});

describe("chooseChiefExecutive", () => {
  it("override wins", () => {
    expect(chooseChiefExecutive({ hosQid: "Q1", hogQid: "Q2", herreMatchHogLeader: "no", override: { role: "head_of_government", justification: "x" } }).role).toBe("head_of_government");
  });
  it("same person → head of state", () => {
    expect(chooseChiefExecutive({ hosQid: "Q1", hogQid: "Q1" }).role).toBe("head_of_state");
  });
  it("uses Herre/V-Dem coding when heads differ", () => {
    expect(chooseChiefExecutive({ hosQid: "Q1", hogQid: "Q2", herreMatchHogLeader: "no" }).role).toBe("head_of_state");
    expect(chooseChiefExecutive({ hosQid: "Q1", hogQid: "Q2", herreMatchHogLeader: "yes" }).role).toBe("head_of_government");
  });
  it("defaults to head of government", () => {
    expect(chooseChiefExecutive({ hosQid: "Q1", hogQid: "Q2" }).role).toBe("head_of_government");
  });
});

describe("sameLeader", () => {
  it("matches surname-only and accented names", () => {
    expect(sameLeader("Putin", "Vladimir Putin")).toBe(true);
    expect(sameLeader("Erdogan", "Recep Tayyip Erdoğan")).toBe(true);
  });
  it("does not match a different member of the same family", () => {
    expect(sameLeader("Hun Sen", "Hun Manet")).toBe(false);
  });
});

describe("presidential systems and multiple memberships", () => {
  it("treats the president as chief when Herre's head of government is a President", () => {
    const r = chooseChiefExecutive({ hosQid: "Q1", hogQid: "Q2", herreMatchHogLeader: "yes", herreHogTitle: "President" });
    expect(r.role).toBe("head_of_state");
    expect(chooseChiefExecutive({ hosQid: "Q1", hogQid: "Q2", herreMatchHogLeader: "yes", herreHogTitle: "Prime Minister" }).role).toBe("head_of_government");
  });

  it("prefers the most recent party over a better-sourced old membership", () => {
    const r = deriveGovernmentPosition({
      ...base,
      chiefParties: [
        { id: 20, name: "Partido Novo" },
        { id: 10, name: "Partido Antigo" },
      ],
      scores: [score({ id: 1, partyId: 10, sourceId: "ches-la-2020", valueNorm: -0.4 }), score({ id: 2, partyId: 20, sourceId: "gps-2019", valueNorm: -0.6, observedYear: 2019 })],
    });
    expect(r.derivation.chosen?.partyId).toBe(20);
    expect(r.valueNorm).toBe(-0.6);
  });
});

describe("label estimates", () => {
  it("uses the declared alignment as a D estimate when nothing else exists", () => {
    const r = deriveGovernmentPosition({ ...base, scores: [score({ method: "alignment_label", sourceId: "wikidata", valueNorm: 0.3, notes: "centre-right" })] });
    expect(r.confidence).toBe("D");
    expect(r.isEstimate).toBe(true);
    expect(r.derivation.rule).toBe("label_estimate");
  });
  it("prefers a survey over any label", () => {
    const r = deriveGovernmentPosition({
      ...base,
      scores: [score({ method: "alignment_label", sourceId: "wikidata", valueNorm: 0.9 }), score({ id: 2, sourceId: "gps-2019", valueNorm: -0.2, observedYear: 2019 })],
    });
    expect(r.valueNorm).toBe(-0.2);
  });
  it("falls back to the leader's own ideology family", () => {
    const r = deriveGovernmentPosition({ ...base, chiefParties: [], scores: [score({ partyId: null, personId: 7, method: "family_label", sourceId: "parlgov", valueNorm: 0.4 })] });
    expect(r.valueNorm).toBe(0.4);
    expect(r.confidence).toBe("D");
  });
});
