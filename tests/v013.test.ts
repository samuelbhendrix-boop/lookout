import { describe, expect, it } from "vitest";
import { carrierOf, parseHpt, productOf } from "@/lib/marketdata/hpt";

describe("hospital price files", () => {
  it("reads every hospital entry from cms-hpt.txt", () => {
    const t = `location-name: Hospital A\nsource-page-url: https://a.org/prices\nmrf-url: https://a.org/04123_a_standardcharges.json\ncontact-name: X\n\nlocation-name: Hospital B\nmrf-url: https://a.org/b.csv\n`;
    expect(parseHpt(t)).toEqual([
      { location: "Hospital A", source: "https://a.org/prices", url: "https://a.org/04123_a_standardcharges.json" },
      { location: "Hospital B", url: "https://a.org/b.csv" },
    ]);
    expect(parseHpt("<html>not found</html>")).toEqual([]);
  });
  it("maps payer names to carriers, with the Blue decided by state", () => {
    expect(carrierOf("Bcbs", "Ppo", "MA")).toBe("Blue Cross Blue Shield of Massachusetts");
    expect(carrierOf("Blue Cross", "PPO", "NH")).toBe("Anthem Blue Cross and Blue Shield");
    expect(carrierOf("HPHC [20001]", "CHA HB HARVARD PILGRIM HEALTHCARE HPI", "MA")).toBe("Harvard Pilgrim Health Care");
    expect(carrierOf("NEIGHBORHOOD HEALTH PLAN [50011]", "x", "MA")).toBe("Mass General Brigham Health Plan");
    expect(carrierOf("RI NEIGHBORHOOD HEALTH PLAN [50017]", "x", "MA")).toBe("Neighborhood Health Plan of Rhode Island");
    expect(carrierOf("BMC HealthNet Plan", "Commercial", "MA")).toBe("WellSense Health Plan");
    expect(carrierOf("Unicare", "Gic Wellpoint All Commercial Plans", "MA")).toBe("UniCare (Elevance)");
    expect(carrierOf("MULTIPLAN [50010]", "CHA HB MULTIPLAN/PHCS", "MA")).toBeNull();
  });
  it("reads the product from the plan name", () => {
    expect(productOf("Ppo")).toBe("PPO");
    expect(productOf("Hmo")).toBe("HMO");
    expect(productOf("Self Insured All Commercial Plans")).toBe("Self-insured");
    expect(productOf("CHA HB TUFTS POS")).toBe("POS");
    expect(productOf("All Commercial Plans")).toBe("All plans");
  });
});
