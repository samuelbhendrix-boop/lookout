import { describe, expect, it } from "vitest";
import { archetypeOf, tagsFor } from "@/lib/marketdata/dossier";
import { ratingAreasOf, hasRatingAreaMap } from "@/components/RatingAreaMap";

const base = { growth: null as number | null, enrolledPrev: 1000, enrolled: 1000, rateChange: 0.1, marketRateChange: 0.1, priceIndex: 1, newPlans: 0, plans: 10, terminated: 0, hsa: 0, qhpPlans: 10, tiered: 0, networks: [], name: "HMO", onExchange: 5, filedLossRatio: 0.85, share: 0.05, cheapestIn: [], oon: 0 };
const read = (o: Partial<typeof base>) => { const p = { ...base, ...o }; const tags = tagsFor(p); return { tags: tags.map((t) => t.id), arch: archetypeOf({ tags, enrolled: p.enrolled }).label }; };

describe("product strategy rules", () => {
  it("in line with market reads as steady", () => expect(read({}).arch).toBe("Steady"));
  it("underpricing the market while growing is a share grab", () => expect(read({ rateChange: 0.05, growth: 0.25, enrolled: 1250 }).arch).toBe("Share grab"));
  it("overpricing while shrinking is margin repair", () => expect(read({ rateChange: 0.16, growth: -0.2, enrolled: 800 }).arch).toBe("Margin repair"));
  it("overpricing with a fat filed margin is a harvest", () => expect(read({ rateChange: 0.16, filedLossRatio: 0.7 }).arch).toBe("Harvest"));
  it("all plans terminated is an exit", () => expect(read({ plans: 0, terminated: 6, enrolled: 0 }).arch).toBe("Exit"));
  it("all plans new with no prior members is a launch", () => expect(read({ enrolledPrev: 0, newPlans: 4, plans: 4, enrolled: 0 }).arch).toBe("Launch"));
  it("ignores small rate differences", () => expect(read({ rateChange: 0.11 }).tags).not.toContain("overprice"));
});

describe("rating areas", () => {
  it("has the CMS area count for every New England state", () => {
    expect(Object.fromEntries(["MA", "CT", "ME", "NH", "RI", "VT"].map((s) => [s, ratingAreasOf(s).length]))).toEqual({ MA: 7, CT: 8, ME: 5, NH: 1, RI: 1, VT: 1 });
    expect(hasRatingAreaMap("NY")).toBe(false);
  });
  it("defines Boston's 021 ZIPs as MA area 5", () => expect(ratingAreasOf("MA").find((a) => a.members.includes("021"))?.id).toBe("Rating Area 5"));
});
