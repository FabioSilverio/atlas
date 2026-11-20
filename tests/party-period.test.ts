import { describe, expect, it } from "vitest";
import { partyPeriodIndex, type CoreParty } from "@/ingest/lib/party-period";

// Party Facts' three Brazilian "Partido Liberal" entries.
const core: CoreParty[] = [
  { partyfacts_id: "8387", country: "BRA", name_short: "PL", name: "Partido Liberal", name_english: "Liberal Party (1837)", year_first: "1837", year_last: "1889" },
  { partyfacts_id: "1823", country: "BRA", name_short: "PL", name: "Partido Liberal", name_english: "Liberal Party", year_first: "1985", year_last: "2006" },
  { partyfacts_id: "4405", country: "BRA", name_short: "PR/PL", name: "Partido da República / Partido Liberal", name_english: "Party of the Republic / Liberal Party", year_first: "2006", year_last: "" },
  { partyfacts_id: "356", country: "BRA", name_short: "PT", name: "Partido dos Trabalhadores", name_english: "Workers' Party", year_first: "1980", year_last: "" },
];
const activeNamesake = partyPeriodIndex(core);
const scored = new Set([4405, 356]);
const hasScore = (pf: number) => scored.has(pf);

describe("activeNamesake", () => {
  it("moves a result from a defunct party to its active namesake", () => {
    expect(activeNamesake(1823, 2026, hasScore)).toBe(4405);
  });
  it("keeps the matched party while it existed", () => {
    expect(activeNamesake(1823, 2002, hasScore)).toBe(1823);
    expect(activeNamesake(356, 2026, hasScore)).toBe(356);
  });
  it("does not jump to a party with a different name", () => {
    expect(activeNamesake(8387, 1950, hasScore)).toBe(8387);
  });
});
