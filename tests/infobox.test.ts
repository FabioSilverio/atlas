import { describe, expect, it } from "vitest";
import { findElectionInfoboxes, firstDate, interpret, linkTarget, plain } from "@/ingest/lib/infobox";

const BR = `{{Infobox election
| previous_election = 2022 Brazilian general election
| module = {{Infobox election
| embed = yes
| election_name = Presidential election
| ongoing = no
| type = presidential
| election_date = 4 October 2026 (first round)<br>25 October 2026 (second round)
| candidate1 = [[Flávio Bolsonaro]]
| party1 = Liberal Party (Brazil, 2006)
| popular_vote1 = 56,104,268
| percentage1 = 47.03%
| candidate2 = [[Luiz Inácio Lula da Silva|Lula da Silva]]
| party2 = Workers' Party (Brazil)
| popular_vote2 = 53,876,617
| percentage2 = 45.16%
| turnout = 78.92% (first round; {{decrease}}0.13 [[Percentage point|pp]])
| module = {{Infobox legislative election
| embed = yes
| election_name = Chamber of Deputies
| election_date = 4 October 2026
| seats_for_election = All 513 seats in the [[Chamber of Deputies (Brazil)|Chamber of Deputies]]
| party1 = Liberal Party (Brazil, 2006)
| party_leader1 = {{nowrap|[[Sóstenes Cavalcante]]}}
| percentage1 = 22.79
| last_election1 = 98
| seats1 = 121
| party2 = Brazil of Hope
| percentage2 = 14.81
| last_election2 = 81
| seats2 = 88
}}
}}
}}`;

describe("infobox parser", () => {
  it("finds nested modules", () => {
    expect(findElectionInfoboxes(BR)).toHaveLength(3);
  });

  it("reads the presidential first round", () => {
    const pres = findElectionInfoboxes(BR).map(interpret).find((e) => e?.kind === "presidential")!;
    expect(pres.date).toBe("2026-10-04");
    expect(pres.results[0]).toMatchObject({ party: "Liberal Party (Brazil, 2006)", candidate: "Flávio Bolsonaro", share: 47.03, votes: 56104268 });
    expect(pres.results[1].candidate).toBe("Lula da Silva");
    expect(pres.turnout).toBe(78.92);
    expect(pres.runoff).toBe("2026-10-25");
  });

  it("reads legislative seats and the body", () => {
    const leg = findElectionInfoboxes(BR).map(interpret).find((e) => e?.kind === "legislative")!;
    expect(leg.body).toBe("Chamber of Deputies");
    expect(leg.totalSeats).toBe(513);
    expect(leg.results[0]).toMatchObject({ seats: 121, seatsBefore: 98, share: 22.79 });
  });

  it("parses dates and links", () => {
    expect(firstDate("{{Start date|2022|10|2|df=y}}")).toBe("2022-10-02");
    expect(firstDate("November 5, 2024")).toBe("2024-11-05");
    expect(linkTarget("[[Workers' Party (Brazil)|PT]]")).toBe("Workers' Party (Brazil)");
    expect(plain("{{nowrap|[[Sóstenes Cavalcante]]}}")).toBe("Sóstenes Cavalcante");
  });
});
