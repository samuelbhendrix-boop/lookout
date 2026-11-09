import { describe, expect, it } from "vitest";
import { canonicalCarrier, shiftMonth } from "@/lib/marketdata/events";
import { newFlow, readFlow } from "@/lib/sso";
import { kindOf } from "../scripts/refresh-snapshots";
import { HOSPITALS, GENERAL } from "@/lib/marketdata/networks";

describe("market events", () => {
  it("groups legal entities under one carrier", () => {
    expect(canonicalCarrier("CIGNA HEALTH AND LIFE INSURANCE COMPANY")).toBe(canonicalCarrier("Cigna"));
    expect(canonicalCarrier("Blue Cross and Blue Shield of Vermont")).toBe("Blue Cross and Blue Shield of Vermont");
    expect(canonicalCarrier("Acme Widgets Inc")).toBeNull();
  });
  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 2)).toBe("2027-01");
  });
});

describe("sso", () => {
  it("round-trips the flow cookie and uses an S256 challenge", () => {
    const f = newFlow("/rates");
    expect(f.challenge).not.toBe(f.verifier);
    expect(readFlow(f.cookie)).toEqual({ state: f.state, nonce: f.nonce, verifier: f.verifier, next: "/rates" });
    expect(readFlow("garbage")).toBeNull();
    expect(readFlow(undefined)).toBeNull();
  });
});

describe("snapshot refresh", () => {
  it("recognises each carrier's host", () => {
    expect(kindOf("https://d25kgz5rikkq4n.cloudfront.net/cost_transparency/mrf/in-network-rates/x.json.gz")).toBe("cigna");
    expect(kindOf("https://mrf.healthsparq.com/aetnacvs-egress.nophi.kyruushsq.com/prd/mrf/AETNACVS_I/ALICSI/x")).toBe("aetna");
    expect(kindOf("https://transparency-in-coverage.uhc.com/api/v1/uhc/blobs/download/x")).toBe("uhc");
    expect(kindOf("https://bcbsma.mrf.bcbs.com/2026-11_700_23C0_in-network-rates.json.gz")).toBe("blue");
    expect(kindOf("")).toBeNull();
  });
});

describe("hospital directory", () => {
  it("covers every New England state with general hospitals and coordinates", () => {
    for (const st of ["MA", "NH", "RI", "ME", "CT", "VT"]) {
      const h = HOSPITALS.filter((x) => x.state === st && GENERAL.has(x.type));
      expect(h.length).toBeGreaterThan(5);
      expect(h.every((x) => x.lat != null && x.lon != null)).toBe(true);
    }
  });
});
