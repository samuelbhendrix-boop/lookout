import { describe, expect, it } from "vitest";
import { fehbEstimate } from "@/lib/marketdata/fehb";

describe("federal employee estimate", () => {
  it("spreads national federal coverage by federal employment", () => {
    const ma = fehbEstimate("MA")!;
    expect(ma.total).toBe(Math.round((8_000_000 * 25_698) / 1_971_401));
    expect(ma.fep + ma.other).toBe(ma.total);
    expect(ma.inChia).toBe(true);
    expect(fehbEstimate("ME")!.inChia).toBe(false);
    expect(fehbEstimate("TX")).toBeNull();
  });
});
