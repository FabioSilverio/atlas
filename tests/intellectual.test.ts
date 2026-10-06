import { describe, expect, it } from "vitest";
import { intellectualRank } from "@/lib/ideology/intellectual";

// Real occupation sets from Wikidata that previously slipped through.
describe("intellectualRank", () => {
  it("excludes athletes and celebrities, even when they comment", () => {
    expect(intellectualRank(["association football coach", "association football player", "sports commentator", "sports columnist"])).toBe(0); // Olaf Thon
    expect(intellectualRank(["association football coach", "association football player", "sports commentator"])).toBe(0); // Gary Neville
    expect(intellectualRank(["actor", "businessperson", "athlete", "sports commentator", "film producer"])).toBe(0); // Caitlyn Jenner
    expect(intellectualRank(["singer", "Internet celebrity", "sociologist", "model"])).toBe(0); // Tiffany Trump
    expect(intellectualRank(["entrepreneur", "booker", "ring announcer", "professional wrestler", "commentator"])).toBe(0); // Vince McMahon
    expect(intellectualRank(["screenwriter", "actor", "writer", "comedian", "performing artist"])).toBe(0); // Stephen Fry
  });

  it("excludes career politicians who merely write or hold a degree", () => {
    expect(intellectualRank(["politician", "economist"])).toBe(0); // Dilma Rousseff
    expect(intellectualRank(["diplomat", "political scientist", "politician", "pianist"])).toBe(0); // Condoleezza Rice
    expect(intellectualRank(["writer", "politician", "military officer", "civil servant", "television presenter"])).toBe(0); // Pete Hegseth
  });

  it("keeps scholars and political commentators, scholars first", () => {
    expect(intellectualRank(["writer", "historian", "civil servant", "musician", "theologian"])).toBe(3); // İbrahim Kalın
    expect(intellectualRank(["economist", "university teacher"])).toBe(3);
    expect(intellectualRank(["editor-in-chief", "television presenter", "columnist", "pundit", "journalist"])).toBe(2); // Tucker Carlson
    expect(intellectualRank(["television presenter", "political pundit"])).toBe(2); // Jesse Watters
    expect(intellectualRank(["writer", "politician", "pundit", "ideologue"])).toBe(2); // JD Vance
    expect(intellectualRank(["writer", "entrepreneur", "investor"])).toBe(1); // Peter Thiel
  });
});
