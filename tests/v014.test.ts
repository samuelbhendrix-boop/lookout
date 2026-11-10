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

import { articleLinks, diffPage, feedLink } from "@/lib/webpage";

const page = (items: string[]) => `<html><head><title>Acme Newsroom</title></head><body><nav><a href="/about">About us</a></nav><main><ul>
${items.map((t, i) => `<li><a href="/news/2026/${t.toLowerCase().replace(/\W+/g, "-")}">${t}</a><span>Nov ${i + 1}, 2026</span></li>`).join("")}
</ul><a href="/search?q=x">Search all of our news releases here please</a><a href="/careers">Careers</a></main></body></html>`;

describe("web page sources", () => {
  const base = "https://acme.example/newsroom";
  const v1 = page(["Acme expands network with Beth Israel", "Acme names new chief medical officer", "Acme files 2027 individual rates"]);
  it("finds headline links, not navigation or search", () => {
    const l = articleLinks(v1, base);
    expect(l.map((x) => x.title)).toEqual(["Acme expands network with Beth Israel", "Acme names new chief medical officer", "Acme files 2027 individual rates"]);
    expect(l[0].publishedAt?.toISOString().slice(0, 10)).toBe("2026-11-01");
  });
  it("records a baseline on the first check, then reports only new headlines", () => {
    const first = diffPage(v1, base, {});
    expect(first.items).toEqual([]);
    const v2 = page(["Acme to acquire Harbor Mutual", "Acme expands network with Beth Israel", "Acme names new chief medical officer", "Acme files 2027 individual rates"]);
    const second = diffPage(v2, base, first.state);
    expect(second.items.map((i) => i.title)).toEqual(["Acme to acquire Harbor Mutual"]);
  });
  it("watches a page that isn't a list for text changes", () => {
    const p = (extra: string) => `<html><body><main><p>Our PPO covers care across New England for members and families.</p><p>Premiums are set every year in the fall by the state.</p>${extra}</main></body></html>`;
    const a = diffPage(p(""), "https://acme.example/ppo", {}, "Acme PPO");
    expect(a.items).toEqual([]);
    const b = diffPage(p("<p>Starting January 2027 the plan adds coverage of Wegovy for weight loss.</p>"), "https://acme.example/ppo", a.state, "Acme PPO");
    expect(b.items).toHaveLength(1);
    expect(b.items[0].summary).toContain("Wegovy");
    expect(diffPage(p(""), "https://acme.example/ppo", a.state).items).toEqual([]);
  });
  it("uses a feed the page advertises", () => {
    expect(feedLink(`<head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head>`, base)).toBe("https://acme.example/feed.xml");
  });
  it("says so when a page is built by JavaScript", () => {
    expect(() => diffPage(`<html><body><div id="root"></div><script>app()</script></body></html>`, base, {})).toThrow(/JavaScript/);
  });
});

import { RECOMMENDED_SOURCES } from "@/lib/recommended-sources";
describe("recommended sources", () => {
  it("are unique, HTTPS, and each says why it's there", () => {
    expect(new Set(RECOMMENDED_SOURCES.map((s) => s.url)).size).toBe(RECOMMENDED_SOURCES.length);
    for (const s of RECOMMENDED_SOURCES) { expect(s.url).toMatch(/^https:\/\//); expect(s.why.length).toBeGreaterThan(20); }
  });
});
