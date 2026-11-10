import { describe, expect, it } from "vitest";
import { estimateAso, type AsoInput } from "@/lib/marketdata/aso-estimate";

const row = (o: Partial<AsoInput>): AsoInput => ({ state: "MA", company: "X", group: null, aso: 0, memberMonths: 0, fees: 0, fiGroup: 0, fiAll: 0, ...o });
const states = ["CT", "MA", "NY", "NJ", "PA", "TX", "FL", "GA", "IL", "OH", "VA", "CA"];

describe("self-funded estimates", () => {
  it("keeps state-by-state filings as reported", () => {
    const out = estimateAso(2024, [row({ company: "Cigna", state: "MA", aso: 400_000, fiGroup: 50_000, fiAll: 50_000 }), row({ company: "Cigna", state: "CT", aso: 600_000, fiGroup: 70_000, fiAll: 70_000 })]);
    expect(out.map((r) => [r.state, r.basis, r.lives])).toEqual(expect.arrayContaining([["MA", "reported", 400_000], ["CT", "reported", 600_000]]));
  });
  it("spreads a national book filed under one state by fully insured group presence", () => {
    const rows = states.map((st, i) => row({ company: "Aetna Life", group: "CVS", state: st, aso: st === "CT" ? 12_000_000 : 0, fiGroup: 100_000 * (i === 1 ? 2 : 1), fiAll: 100_000 }));
    const out = estimateAso(2024, rows);
    expect(out.every((r) => r.basis === "allocated")).toBe(true);
    expect(out.find((r) => r.state === "MA")!.lives).toBe(Math.round((12_000_000 * 200_000) / 1_300_000));
    expect(Math.round(out.reduce((s, r) => s + r.lives, 0) / 1000)).toBe(12_000);
  });
  it("leaves a single-state Blue plan alone even inside a multi-state group", () => {
    const out = estimateAso(2024, [row({ company: "Anthem Health Plans, Inc.", group: "Elevance", state: "CT", aso: 1_100_000, fiGroup: 130_000, fiAll: 200_000 }), ...states.map((st) => row({ company: `Anthem ${st}`, group: "Elevance", state: st, fiGroup: 100_000, fiAll: 100_000 }))]);
    expect(out).toEqual([expect.objectContaining({ state: "CT", basis: "reported", lives: 1_100_000 })]);
  });
  it("skips dental-only administrators and estimates UnitedHealthcare from its national disclosure", () => {
    const out = estimateAso(2024, [row({ company: "Guardian Life", state: "MA", aso: 70_000 }), row({ company: "UnitedHealthcare Insurance Company", state: "MA", fiGroup: 100_000, fiAll: 100_000 }), row({ company: "UnitedHealthcare Insurance Company", state: "TX", fiGroup: 900_000, fiAll: 900_000, aso: 8 })]);
    expect(out.find((r) => r.company.startsWith("Guardian"))).toBeUndefined();
    expect(out.find((r) => r.state === "MA")).toMatchObject({ basis: "disclosed", lives: 2_088_500 });
    expect(out.filter((r) => r.basis === "reported")).toHaveLength(0);
  });
});
