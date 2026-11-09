import { describe, expect, it } from "vitest";
import { DIRECTORY_SOURCES, PCP, WATCHLIST } from "@/lib/marketdata/directory";

const group = (name: string) => WATCHLIST.find((w) => w.match.test(name))?.group;

describe("plan directories and formularies", () => {
  it("files watch-list drugs by RxNorm name, keeping weight-loss and diabetes GLP-1s apart", () => {
    expect(group("semaglutide 2.4 MG in 0.75 ML Auto-Injector [Wegovy]")).toMatch(/weight loss/);
    expect(group("semaglutide 1 MG/DOSE Pen Injector [Ozempic]")).toMatch(/diabetes/);
    expect(group("tirzepatide 5 MG in 0.5 ML Auto-Injector [Zepbound]")).toMatch(/weight loss/);
    expect(group("adalimumab-adaz 40 MG/0.4ML Prefilled Syringe")).toMatch(/Adalimumab/);
    expect(group("lisinopril 10 MG Oral Tablet")).toBeUndefined();
  });
  it("counts primary care specialties, not pediatric subspecialties", () => {
    expect(PCP.test("Family Medicine")).toBe(true);
    expect(PCP.test("Internal Medicine")).toBe(true);
    expect(PCP.test("Pediatrics")).toBe(true);
    expect(PCP.test("Pediatric Cardiology")).toBe(false);
    expect(PCP.test("Orthopaedic Surgery")).toBe(false);
  });
  it("only fetches from issuers' published indexes, over HTTPS", () => {
    for (const s of DIRECTORY_SOURCES) expect(s.index).toMatch(/^https:\/\//);
    expect(new Set(DIRECTORY_SOURCES.flatMap((s) => s.issuers)).size).toBe(DIRECTORY_SOURCES.flatMap((s) => s.issuers).length);
  });
});
