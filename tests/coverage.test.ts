import { describe, expect, it } from "vitest";
import kff from "@/data/benchmarks/kff-coverage.json";

describe("coverage benchmark", () => {
  it("has KFF employer and non-group counts for every New England state", () => {
    for (const st of ["MA", "CT", "RI", "NH", "VT", "ME"]) {
      const s = (kff.states as Record<string, { employer: number; nonGroup: number; total: number }>)[st];
      expect(s.employer).toBeGreaterThan(100_000);
      expect(s.nonGroup).toBeGreaterThan(10_000);
      expect(s.employer + s.nonGroup).toBeLessThan(s.total);
    }
  });
});
