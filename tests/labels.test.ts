import { describe, expect, it } from "vitest";
import { alignmentEstimate, familyOf } from "@/lib/ideology/labels";

describe("label mappings", () => {
  it("maps alignment labels and averages several", () => {
    expect(alignmentEstimate(["centre-left"])?.value).toBe(-0.3);
    expect(alignmentEstimate(["right-wing", "far-right"])?.value).toBe(0.725);
    expect(alignmentEstimate(["big tent"])).toBeNull();
  });
  it("picks the most specific family", () => {
    expect(familyOf(["conservatism", "right-wing populism"])?.family).toBe("right");
    expect(familyOf(["social democracy"])?.family).toBe("soc");
    expect(familyOf(["Christian democracy", "conservatism"])?.family).toBe("chr");
    expect(familyOf(["Islamism"])).toBeNull();
  });
});
