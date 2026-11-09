import { describe, expect, it } from "vitest";
import { brokerKey, nextAnniversary, sameBroker } from "@/lib/marketdata/inplay";
import { MARKET_NOISE, whyItMatters } from "@/lib/briefing";
import { isNewlyDetected } from "@/lib/marketdata/events";
import { formatDigest } from "@/lib/alerts";

describe("broker names", () => {
  it("treats spelling drift as the same broker", () => {
    expect(brokerKey("HUB INTERNATIONAL N E LLC")).toBe(brokerKey("HUB INTERNATIONAL NEW ENGLAND LLC"));
    expect(brokerKey("CARRAGHER, BRIAN")).toBe(brokerKey("BRIAN CARRAGHER"));
    expect(sameBroker(brokerKey("PATRIOT GROWTH INS. SERVICES, LLC"), brokerKey("PATRIOT GROWTH INSURANCE SERVICES"))).toBe(true);
    expect(sameBroker(brokerKey("NEWFRONT INSURANCE"), brokerKey("ABD INS. AND FINANCIAL SVCS., INC."))).toBe(true);
  });
  it("tells different brokers apart even when they share generic words", () => {
    expect(sameBroker(brokerKey("GALLAGHER BENEFIT SERVICES INC"), brokerKey("USI INSURANCE SERVICES LLC"))).toBe(false);
    expect(sameBroker(brokerKey("Lockton Companies"), brokerKey("Marsh & McLennan Agency"))).toBe(false);
  });
});

describe("renewal dates", () => {
  it("returns the next anniversary on or after today", () => {
    const today = new Date("2026-11-09T12:00:00Z");
    expect(nextAnniversary(new Date("2024-01-01T00:00:00Z"), today).toISOString().slice(0, 10)).toBe("2027-01-01");
    expect(nextAnniversary(new Date("2024-12-01T00:00:00Z"), today).toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(nextAnniversary(new Date("2023-11-09T00:00:00Z"), today).toISOString().slice(0, 10)).toBe("2026-11-09");
  });
});

describe("briefing", () => {
  it("writes a specific implication per kind of change", () => {
    expect(whyItMatters({ kind: "rate_filing", type: "PRICING", title: "X MA individual 2026: average rate change +18.4%", competitor: "X" })).toMatch(/18% increase/);
    expect(whyItMatters({ kind: "rate_filing", type: "PRICING", title: "X NH individual 2026: average rate change −21.5%", competitor: "X" })).toMatch(/cutting price/);
    expect(whyItMatters({ kind: "account_lost", type: "OTHER", title: "t", competitor: "X", data: { to: ["Y"] } })).toMatch(/to Y/);
    expect(whyItMatters({ kind: "account_lost", type: "OTHER", title: "t", competitor: "X", data: { selfFunded: true } })).toMatch(/self-funding/);
    expect(whyItMatters({ kind: "network_drop", type: "NETWORK", title: "t", competitor: "X" })).toMatch(/Confirm before acting/);
  });
  it("keeps stock quotes and analyst ratings out", () => {
    expect(MARKET_NOISE.test("Bernstein Maintains Molina Healthcare(MOH.US) With Buy Rating, Maintains Target Price $266")).toBe(true);
    expect(MARKET_NOISE.test("Oscar Health, Inc. (OSCR) Stock Price, News, Quote & History")).toBe(true);
    expect(MARKET_NOISE.test("Harvard Pilgrim files 9.8% rate increase for small groups")).toBe(false);
  });
  it("treats the first bulk load of filings as history, later detections as news", () => {
    const now = Date.UTC(2026, 11, 20);
    const cutoffs = new Map([["account_won", new Date(Date.UTC(2026, 10, 10))]]);
    expect(isNewlyDetected({ kind: "account_won", createdAt: new Date(Date.UTC(2026, 10, 9, 12)) }, cutoffs, 864e5 * 60, now)).toBe(false);
    expect(isNewlyDetected({ kind: "account_won", createdAt: new Date(Date.UTC(2026, 11, 19)) }, cutoffs, 48 * 3600e3, now)).toBe(true);
    expect(isNewlyDetected({ kind: "rate_change", createdAt: new Date(Date.UTC(2026, 11, 19)) }, new Map(), 48 * 3600e3, now)).toBe(true);
    expect(isNewlyDetected({ kind: "rate_change", createdAt: new Date(Date.UTC(2026, 11, 1)) }, new Map(), 48 * 3600e3, now)).toBe(false);
  });
  it("adds why-it-matters lines and a briefing link to the digest", () => {
    const t = formatDigest("Weekly", [{ id: "1", title: "T", type: "PRICING", importance: 4, competitor: "X", coverage: 0, why: "Because." }], "https://app");
    expect(t).toContain("↳ Because.");
    expect(t).toContain("https://app/briefing");
  });
});
