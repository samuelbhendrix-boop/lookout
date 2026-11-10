import { describe, expect, it } from "vitest";
import { systemOf } from "@/lib/marketdata/networks";

describe("health systems", () => {
  it("maps hospitals to their system by name", () => {
    expect(systemOf("MASSACHUSETTS GENERAL HOSPITAL")).toBe("Mass General Brigham");
    expect(systemOf("WENTWORTH-DOUGLASS HOSPITAL")).toBe("Mass General Brigham");
    expect(systemOf("BETH ISRAEL DEACONESS HOSPITAL - NEEDHAM")).toBe("Beth Israel Lahey Health");
    expect(systemOf("SAINT MARY'S HOSPITAL")).toBe("Trinity Health Of New England");
    expect(systemOf("ST MARY'S REGIONAL MEDICAL CENTER")).toBe("Covenant Health");
    expect(systemOf("STURDY MEMORIAL HOSPITAL")).toBeNull();
  });
});
