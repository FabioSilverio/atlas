import { describe, expect, it } from "vitest";
import { auditCountry, pickLatest, pickRise, pickStrength, type AuditInput, type ElectionItem, type ElectionResultRow } from "@/lib/government-context";

let nextId = 1;
const row = (o: Partial<ElectionResultRow>): ElectionResultRow => ({ party: "X", partyfactsId: null, candidate: null, seats: null, seatsBefore: null, share: null, econ: null, scoreSource: null, ...o });
const election = (o: Partial<ElectionItem>): ElectionItem => ({
  id: nextId++, date: "2022-10-02", kind: "presidential", body: "Presidente", title: "", status: "held", totalSeats: null,
  turnout: null, econ: null, galtan: null, coverage: null, winner: null, url: null, drift: null, results: [], ...o,
});

// Brazil as it stood on 2026-11-20: Lula in office since 2023, re-elected in October 2026,
// Senate and Chamber renewed the same day.
const pres2022 = election({ date: "2022-10-02", results: [row({ candidate: "Lula da Silva", party: "Workers' Party (Brazil)", share: 50.9 }), row({ candidate: "Jair Bolsonaro", party: "Liberal Party (Brazil)", share: 49.1 })] });
const pres2026 = election({ date: "2026-10-04", results: [row({ candidate: "Lula da Silva", party: "Workers' Party (Brazil)", share: 51.8 }), row({ candidate: "Flávio Bolsonaro", party: "Liberal Party (Brazil)", share: 48.2 })] });
const senate2026 = election({ date: "2026-10-04", kind: "legislative", body: "Federal Senate", totalSeats: 81, results: [row({ party: "Liberal Party (Brazil)", seats: 29 }), row({ party: "Workers' Party (Brazil)", partyfactsId: 356, seats: 9 })] });
const chamber2026 = election({ date: "2026-10-04", kind: "legislative", body: "Chamber of Deputies", totalSeats: 513, results: [row({ party: "Liberal Party (Brazil)", seats: 121 }), row({ party: "Brazil of Hope", partyfactsId: 356, seats: 88 })] });
const brazil = [senate2026, chamber2026, pres2026, pres2022];
const lula = { name: "Luiz Inácio Lula da Silva", since: "2023-01-01", partyName: "Partido dos Trabalhadores", partyfactsId: 356 };

describe("pickRise", () => {
  it("shows a re-election won after the mandate began", () => {
    const r = pickRise(brazil, lula)!;
    expect(r.election.date).toBe("2026-10-04");
    expect(r.reelected).toBe(true);
    expect(r.opponent?.candidate).toBe("Flávio Bolsonaro");
  });

  it("keeps the election that brought the leader in when they lost or the count is open", () => {
    const lost = election({ date: "2026-10-04", results: [row({ candidate: "Flávio Bolsonaro" }), row({ candidate: "Lula da Silva" })] });
    expect(pickRise([lost, pres2022], lula)!.election.date).toBe("2022-10-02");
    const open = election({ date: "2026-10-04", status: "ongoing", results: [row({ candidate: "Lula da Silva" })] });
    expect(pickRise([open, pres2022], lula)!.election.date).toBe("2022-10-02");
  });

  it("finds a candidate listed under a shorter name", () => {
    const e = election({ date: "2022-05-29", results: [row({ candidate: "Gustavo Petro" }), row({ candidate: "Rodolfo Hernández" })] });
    expect(pickRise([e], { name: "Gustavo Petro Urrego", since: "2022-08-07", partyName: null, partyfactsId: null })?.winnerRow?.candidate).toBe("Gustavo Petro");
  });

  it("falls back to the lower chamber vote before a prime minister took office", () => {
    const upper = election({ date: "2024-07-04", kind: "legislative", body: "House of Lords", results: [row({ party: "Labour", seats: 1 })] });
    const lower = election({ date: "2024-07-04", kind: "legislative", body: "House of Commons", results: [row({ party: "Labour Party", seats: 411 }), row({ party: "Conservative Party", seats: 121 })] });
    const r = pickRise([upper, lower], { name: "Keir Starmer", since: "2024-07-05", partyName: "Labour Party", partyfactsId: null })!;
    expect(r.election.body).toBe("House of Commons");
    expect(r.matched).toBe("legislative");
  });
});

describe("pickStrength", () => {
  it("prefers the lower chamber over a Senate renewed the same day", () => {
    const s = pickStrength(brazil, lula)!;
    expect(s).toMatchObject({ seats: 88, total: 513, body: "Chamber of Deputies", label: "Brazil of Hope" });
  });

  it("uses the upper chamber only when the party is missing from the lower one", () => {
    const s = pickStrength([senate2026, election({ ...chamber2026, results: [row({ party: "Liberal Party (Brazil)", seats: 121 })] })], lula)!;
    expect(s.body).toBe("Federal Senate");
    expect(s.label).toBe("Workers' Party");
  });
});

describe("pickLatest", () => {
  it("puts the presidential vote first on a shared election day", () => {
    expect(pickLatest(brazil)?.kind).toBe("presidential");
  });
});

describe("auditCountry", () => {
  const base: AuditInput = { code: "BRA", name: "Brasil", sovereign: true, role: "head_of_state", leader: lula, elections: brazil, nextElectionOn: null, econ: -0.4, galtan: -0.2, today: "2026-11-20" };

  it("finds nothing wrong with a consistent country", () => {
    expect(auditCountry(base)).toEqual([]);
  });

  it("flags a count left open for weeks and a past 'next election'", () => {
    const stale = election({ date: "2026-08-01", status: "ongoing", results: [row({ candidate: "Lula da Silva" })] });
    const issues = auditCountry({ ...base, elections: [stale, ...brazil], nextElectionOn: "2026-10-04" });
    expect(issues.map((i) => i.message).join(" | ")).toMatch(/em andamento.*111 dias/);
    expect(issues.some((i) => /data passada/.test(i.message))).toBe(true);
  });

  it("flags a head of state who lost the last presidential vote months ago", () => {
    const lost = election({ date: "2026-06-21", results: [row({ candidate: "Abelardo de la Espriella" }), row({ candidate: "Iván Cepeda" })] });
    const issues = auditCountry({ ...base, code: "COL", leader: { name: "Gustavo Petro Urrego", since: "2022-08-07", partyName: null, partyfactsId: null }, elections: [lost] });
    expect(issues.find((i) => i.severity === "erro")?.message).toMatch(/desatualizado.*Espriella/);
  });

  it("flags a sovereign country left without any ideological position", () => {
    expect(auditCountry({ ...base, econ: null, galtan: null }).map((i) => i.message)).toContain("Sem posição ideológica em nenhum eixo");
  });
});
