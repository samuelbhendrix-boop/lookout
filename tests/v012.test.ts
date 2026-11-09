import { describe, expect, it } from "vitest";
import { money, pct } from "@/lib/marketdata/qhp";
import { planKey } from "@/lib/marketdata/products";

describe("QHP file values", () => {
  it("parses dollar amounts in both file layouts", () => {
    expect(money("$2,000 ")).toBe(2000);
    expect(money("$2000 per person | $4000 per group", true)).toBe(4000);
    expect(money("per person not applicable | per group not applicable", true)).toBeNull();
    expect(money("Not Applicable")).toBeNull();
    expect(money("")).toBeNull();
    expect(money("$25.00 Copay after deductible")).toBe(25);
  });
  it("parses percentages", () => {
    expect(pct("71.70%")).toBeCloseTo(0.717);
    expect(pct("0.00%")).toBe(0);
    expect(pct("")).toBeNull();
  });
});

describe("plan matching across years", () => {
  it("matches a renumbered plan by name and metal, ignoring the year", () => {
    expect(planKey({ name: "Tufts Health Direct Silver 2000 II 2025", metal: "Silver" })).toBe(planKey({ name: "Tufts Health Direct Silver 2000 II", metal: "Silver" }));
    expect(planKey({ name: "Bronze 2900", metal: "Expanded Bronze" })).toBe(planKey({ name: "Bronze 2900", metal: "Bronze" }));
    expect(planKey({ name: "Silver 2000", metal: "Silver" })).not.toBe(planKey({ name: "Silver 2500", metal: "Silver" }));
  });
});
