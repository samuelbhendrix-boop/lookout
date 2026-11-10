import { describe, expect, it } from "vitest";
import { htmlText, urlScore } from "@/lib/marketing/crawl";
import { ARCHETYPES } from "@/lib/marketing/extract";
import { siteFor } from "@/lib/marketing/sites";

describe("product marketing crawler", () => {
  it("reads main content, keeps ASP.NET form pages, and falls back from a placeholder main", () => {
    const long = "Blue Options is a tiered network plan. ".repeat(12);
    expect(htmlText(`<html><body><nav>Menu</nav><main><h2>Blue Options</h2><p>${long}</p></main><footer>x</footer></body></html>`).text).toMatch(/^## Blue Options\nBlue Options is a tiered/);
    expect(htmlText(`<html><body><form id="mainform"><div><p>${long}</p></div></form></body></html>`).text.length).toBeGreaterThan(300);
    expect(htmlText(`<html><body><main>Loading page</main><div><h3>Oscar Virtual Care</h3><p>${long}</p></div></body></html>`).text).toContain("Oscar Virtual Care");
  });
  it("prefers product pages over member servicing and Medicare", () => {
    expect(urlScore("https://x.org/employer/small-group-plans")).toBeGreaterThan(urlScore("https://x.org/members/claims"));
    expect(urlScore("https://x.org/medicare/plans")).toBeLessThan(urlScore("https://x.org/individual/plans"));
  });
  it("maps competitor names to sites and products to archetypes", () => {
    expect(siteFor("Point32Health")?.key).toBe("point32");
    expect(siteFor("Elevance Health (Anthem)")?.key).toBe("anthem");
    expect(siteFor("Humana")?.skip).toBeTruthy();
    const p = { name: "X", segments: [], states: [], network: "limited", virtualFirst: true, costDesign: ["HSA-eligible"], funding: ["level-funded"], claims: [], partners: [], docs: [], sources: [] } as never;
    expect(ARCHETYPES.filter((a) => a.test(p)).map((a) => a.key)).toEqual(["virtual", "limited", "cdhp", "level"]);
  });
});
