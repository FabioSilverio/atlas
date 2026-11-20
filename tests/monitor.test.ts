import { describe, expect, it } from "vitest";
import { actorMatcher, fold, leanOf, sideOf, type ActorRef } from "@/ingest/lib/monitor";

const actors: ActorRef[] = [
  { id: 1, name: "Workers' Party", aliases: ["PT", "partido dos trabalhadores"], econ: -0.477, partyLabel: null },
  { id: 2, name: "Liberal Party", aliases: ["PL", "partido liberal"], econ: 0.44, partyLabel: null },
  { id: 3, name: "Luiz Inácio Lula da Silva", aliases: ["lula", "luiz inacio lula da silva"], econ: -0.477, partyLabel: "Workers' Party" },
  { id: 4, name: "Jair Bolsonaro", aliases: ["jair bolsonaro", "bolsonaro"], econ: 0.44, partyLabel: "Liberal Party" },
  { id: 5, name: "Podemos", aliases: ["=Podemos"], econ: null, partyLabel: null },
  { id: 6, name: "Партия", aliases: [fold("Единая Россия")], econ: 0.3, partyLabel: null },
];
const m = actorMatcher(actors);
const ids = (t: string) => m.find(t).map((a) => a.id).sort();

describe("actorMatcher", () => {
  it("finds names and acronyms in headlines, accent- and case-insensitively", () => {
    expect(ids("Lula e Bolsonaro trocam ataques após pesquisa")).toEqual([3, 4]);
    expect(ids("PL quer CPI; PT reage")).toEqual([1, 2]);
    expect(ids("LULA sanciona lei")).toEqual([3]);
  });
  it("does not match acronyms inside words or in lower case", () => {
    expect(ids("Aplicativo de pt-br ganha atualização")).toEqual([]);
    expect(ids("PLANALTO anuncia medidas")).toEqual([]);
  });
  it("matches one-word party names only capitalised and not as the first word", () => {
    expect(ids("Podemos avançar na reforma, diz ministro")).toEqual([]);
    expect(ids("nós podemos avançar")).toEqual([]);
    expect(ids("Deputado do Podemos deixa a legenda")).toEqual([5]);
  });
  it("works for non-Latin scripts", () => {
    expect(ids("«Единая Россия» объявила список")).toEqual([6]);
  });
});

describe("leanOf / sideOf", () => {
  it("averages the positions of mentioned actors and names them", () => {
    const l = leanOf(m.find("Lula e Bolsonaro"));
    expect(l.econ).toBeCloseTo(-0.018, 3);
    expect(l.basis).toContain("Lula");
    expect(leanOf(m.find("Deputado do Podemos"))).toEqual({ econ: null, basis: null });
  });
  it("splits the scale into three sides", () => {
    expect(sideOf(-0.4)).toBe("left");
    expect(sideOf(0.05)).toBe("center");
    expect(sideOf(0.2)).toBe("right");
  });
});
