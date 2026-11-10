import { describe, expect, it } from "vitest";
import { chiaEdition, urrtYear } from "@/lib/marketdata/discover";

describe("release discovery", () => {
  it("reads the plan year from CMS rate-review file names", () => {
    expect(urrtYear("https://www.cms.gov/files/zip/py2025puf20241024.zip")).toBe(2025);
    expect(urrtYear("https://www.cms.gov/files/zip/py2026-puf-20260327.zip")).toBe(2026);
    expect(urrtYear("https://www.cms.gov/files/zip/urr-puf-2027.zip")).toBe(2027);
    expect(urrtYear("https://www.cms.gov/files/zip/py20204-puf-20231031.zip")).toBeNull(); // CMS's typo: skipped, not misread as 2020
  });
  it("reads CHIA databook editions", () => {
    expect(chiaEdition("https://www.chiamass.gov/wp-content/uploads/Uploads/enrollment/2025-September/Enrollment-Trends-Data-thru-September-2025-Databook.xlsx")).toEqual({ year: 2025, month: 8 });
    expect(chiaEdition("https://www.chiamass.gov/assets/Uploads/enrollment/2022-march/Enrollment-Trends-Data-through-September-2021-Databook.xlsx")).toEqual({ year: 2021, month: 8 });
    expect(chiaEdition("https://www.chiamass.gov/x/Enrollment-Monitoring-through-June-2021-databook.xlsx")).toBeNull();
  });
});
