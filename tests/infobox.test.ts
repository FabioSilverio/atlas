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

describe("chamber names and race kinds", () => {
  it("strips the seat arithmetic from chamber names", async () => {
    const { cleanBody } = await import("@/ingest/lib/infobox");
    expect(cleanBody("Folketing 175 from Denmark, 2 from Greenland and 2 from the Faroe Islands")).toBe("Folketing");
    expect(cleanBody("National Council (101 seats needed for a majority) All 46 seats in the Council of States")).toBe("National Council");
    expect(cleanBody("House of Representatives, including 11 overhang seats 66 seats needed for a majority")).toBe("House of Representatives");
    expect(cleanBody("Chamber of Deputies 54 of the 81 seats in the Senate")).toBe("Chamber of Deputies");
    expect(cleanBody("the Federal Senate")).toBe("Federal Senate");
  });

  it("does not file a candidate-less vote summary as a presidential race", () => {
    const [box] = findElectionInfoboxes(`{{Infobox election
| election_name = 2010 United States Senate elections
| election_date = November 2, 2010
| party1 = [[Republican Party (United States)|Republican]]
| popular_vote1 = 32,000,000
| percentage1 = 51.9%
| party2 = [[Democratic Party (United States)|Democratic]]
| popular_vote2 = 29,000,000
| percentage2 = 47.1%
}}`);
    expect(interpret(box)).toBeNull();
  });
});

describe("presidential nominees", () => {
  it("reads US-style nomineeN fields as candidates", () => {
    const [box] = findElectionInfoboxes(`{{Infobox election
| election_name = 2022 South Korean presidential election
| election_date = March 9, 2022
| nominee1 = '''[[Yoon Suk Yeol]]'''
| party1 = People Power Party
| percentage1 = 48.56%
| nominee2 = [[Lee Jae Myung]]
| party2 = [[Democratic Party (South Korea, 2015)|Democratic]]
| percentage2 = 47.83%
}}`);
    const e = interpret(box)!;
    expect(e.kind).toBe("presidential");
    expect(e.results.map((r) => r.candidate)).toEqual(["Yoon Suk Yeol", "Lee Jae Myung"]);
  });
});

describe("embedded modules", () => {
  it("ignores vice-presidential modules that would overwrite the president", () => {
    const boxes = findElectionInfoboxes(`{{Infobox election
| election_name = 2026 Vietnamese presidential election
| election_date = 7 April 2026
| party1 = Communist Party of Vietnam
| nominee1 = '''[[Tô Lâm]]'''
| percentage1 = '''100%'''
| title = [[President of Vietnam|President]]
}}
{{Infobox election
| type = presidential
| party1 = Communist Party of Vietnam
| nominee1 = '''[[Võ Thị Ánh Xuân]]'''
| percentage1 = '''100%'''
| title = [[Vice President of Vietnam|Vice President]]
}}`);
    const parsed = boxes.map(interpret).filter(Boolean);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.results[0].candidate).toBe("Tô Lâm");
  });

  it("keeps the parent box date for result-only modules of a general election", () => {
    const boxes = findElectionInfoboxes(`{{Infobox election
| election_name = 2025 Malawian general election
| election_date = 16 September 2025
| module = {{Infobox election
| embed = yes
| type = presidential
| candidate1 = '''[[Peter Mutharika]]'''
| party1 = Democratic Progressive Party (Malawi)
| percentage1 = '''56.76%'''
| candidate2 = [[Lazarus Chakwera]]
| party2 = Malawi Congress Party
| percentage2 = 33.01%
}}
}}`);
    const parentDate = boxes.map((b) => firstDate(b.params.election_date)).find(Boolean);
    const pres = boxes.map(interpret).find((e) => e?.kind === "presidential");
    expect(parentDate).toBe("2025-09-16");
    expect(pres?.date ?? null).toBeNull();
    expect(pres?.results[0].candidate).toBe("Peter Mutharika");
  });
});
