import { describe, expect, it } from "vitest";
import { brandOf, themesOf } from "@/lib/reports/launches";

describe("launch report classification", () => {
  it("groups subsidiaries under their parent", () => {
    expect(brandOf("Bankers Reserve Life Insurance Company of Wisconsin")).toBe("Centene (Ambetter)");
    expect(brandOf("Simply Healthcare Plans, Inc. doing business as Wellpoint Florida, Inc.")).toBe("Elevance (Anthem/Wellpoint)");
    expect(brandOf("UPMC Health Network, Inc.")).toBe("UPMC");
    expect(brandOf("UPMC Health Options, Inc.")).toBe("UPMC"); // not Florida Blue's "Health Options, Inc."
    expect(brandOf("Health Options, Inc.")).toBe("Florida Blue");
  });
  it("tags distinctive designs from any plan, common variants only from most plans", () => {
    expect(themesOf("Oscar Individual HMO", ["Bronze Simple Diabetes", "Silver Classic", "Gold Classic"], "Oscar")).toContain("condition");
    expect(themesOf("UHC IND EPO", ["Bronze HSA", "Silver", "Gold"], "UnitedHealthcare")).not.toContain("hsa");
    expect(themesOf("EPO EHB with Dental", ["National Access EPO Gold"], "Harvard Pilgrim")).not.toContain("dental"); // pediatric dental only
    expect(themesOf("Ambetter + Vision + Adult Dental", [], "Celtic Insurance Company")).toContain("dental");
  });
});
