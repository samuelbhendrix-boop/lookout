import { describe, expect, it } from "vitest";
import { classifyByRules } from "@/lib/classify";
import { dedupeKey, matchCompetitor, normalizeUrl } from "@/lib/match";
import { ruleMatches } from "@/lib/alerts";

describe("classifyByRules", () => {
  it("detects M&A as high importance", () => {
    const c = classifyByRules("Northwind to acquire regional TPA in $1.2 billion deal");
    expect(c.type).toBe("M_AND_A");
    expect(c.importance).toBeGreaterThanOrEqual(4);
  });
  it("detects pricing", () => {
    expect(classifyByRules("Harbor files 9.8% rate increase").type).toBe("PRICING");
  });
  it("catches pricing word forms", () => {
    expect(classifyByRules("Broker says Harbor discounting 3% on 50-99 groups").type).toBe("PRICING");
    expect(classifyByRules("Keystone undercuts on renewals").type).toBe("PRICING");
  });
  it("falls back to OTHER/1", () => {
    expect(classifyByRules("Company sponsors charity 5k")).toEqual({ type: "OTHER", importance: 1 });
  });
});

describe("matchCompetitor", () => {
  const comps = [
    { id: "a", name: "Northwind Health", aliases: ["northwind", "nwh"] },
    { id: "b", name: "Harbor Mutual", aliases: ["harbor"] },
  ];
  it("matches aliases case-insensitively on word boundaries", () => {
    expect(matchCompetitor("NWH expands network", comps)).toBe("a");
    expect(matchCompetitor("Harborview hospital opens", comps)).toBeNull();
  });
  it("picks the most-mentioned competitor", () => {
    expect(matchCompetitor("Harbor vs Northwind: Harbor wins Harbor bid", comps)).toBe("b");
  });
});

describe("dedupe", () => {
  it("normalizes tracking params, www and trailing slash", () => {
    expect(normalizeUrl("https://www.x.com/a/?utm_source=rss&id=3#top")).toBe("https://x.com/a/?id=3");
  });
  it("same article from two feeds → same key", () => {
    expect(dedupeKey("w", "https://x.com/a?utm_medium=feed", "A")).toBe(dedupeKey("w", "https://www.x.com/a", "B"));
  });
  it("is workspace scoped", () => {
    expect(dedupeKey("w1", "https://x.com/a", "t")).not.toBe(dedupeKey("w2", "https://x.com/a", "t"));
  });
});

describe("ruleMatches", () => {
  const signal = { competitorId: "a", type: "PRICING" as const, importance: 4, title: "Rate hike in Medicare Advantage", summary: null };
  const base = { competitorIds: [] as string[], types: [] as never[], keywords: [] as string[], minImportance: 1 };
  it("empty rule matches everything above threshold", () => expect(ruleMatches(base, signal)).toBe(true));
  it("respects importance floor", () => expect(ruleMatches({ ...base, minImportance: 5 }, signal)).toBe(false));
  it("ANDs conditions", () => {
    expect(ruleMatches({ ...base, competitorIds: ["a"], types: ["PRICING"] as never[] }, signal)).toBe(true);
    expect(ruleMatches({ ...base, competitorIds: ["b"], types: ["PRICING"] as never[] }, signal)).toBe(false);
  });
  it("keywords are any-of, case-insensitive", () => {
    expect(ruleMatches({ ...base, keywords: ["medicare advantage", "exit"] }, signal)).toBe(true);
    expect(ruleMatches({ ...base, keywords: ["exit"] }, signal)).toBe(false);
  });
});

import { findLead, isSameStory, titleTokens } from "@/lib/cluster";

describe("story clustering", () => {
  const same = (a: string, b: string) => isSameStory(titleTokens(a), titleTokens(b));
  it("groups the same event across outlets", () => {
    expect(same("Harbor Mutual announces merger with Bayline Health", "Harbor Mutual, Bayline Health to merge in $3B deal")).toBe(true);
    expect(same("Keystone Care launches virtual-first plan for small employers", "Keystone Care launches virtual-first small employer plan")).toBe(true);
  });
  it("keeps different numbers apart", () => {
    expect(same("Harbor Mutual Q3 earnings beat estimates", "Harbor Mutual Q2 earnings beat estimates")).toBe(false);
    expect(same("Harbor files 9.8% rate increase in Maine", "Harbor files 6.1% rate increase in Maine")).toBe(false);
  });
  it("does not merge different events for the same company", () => {
    expect(same("Harbor Mutual names new CFO", "Harbor Mutual launches Medicare plan")).toBe(false);
  });
  it("findLead respects competitor and points at the story lead", () => {
    const cands = [
      { id: "lead", title: "Harbor Mutual announces merger with Bayline Health", duplicateOfId: null, competitorId: "h" },
      { id: "dup", title: "Harbor Mutual and Bayline Health agree to merge", duplicateOfId: "lead", competitorId: "h" },
    ];
    expect(findLead("Bayline Health, Harbor Mutual merger announced", "h", cands)).toBe("lead");
    expect(findLead("Bayline Health, Harbor Mutual merger announced", "other", cands)).toBeNull();
  });
});

import { isPrivateAddress } from "@/lib/net";
import { formatDigest } from "@/lib/alerts";

describe("SSRF guard", () => {
  it("flags private, loopback, link-local and metadata ranges", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])
      expect(isPrivateAddress(ip), ip).toBe(true);
  });
  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe("formatDigest", () => {
  it("groups by competitor and notes coverage", () => {
    const t = formatDigest("Weekly", [
      { id: "1", title: "Harbor merger", type: "M_AND_A", importance: 5, competitor: "Harbor", coverage: 3 },
      { id: "2", title: "CMS rule", type: "REGULATORY", importance: 3, competitor: null, coverage: 0 },
    ], "https://app");
    expect(t).toContain("*Harbor*");
    expect(t).toContain("*Market*");
    expect(t).toContain("(+3 outlets)");
    expect(t).toContain("<https://app/signals/1|Harbor merger>");
  });
  it("sends a quiet-week message when empty", () => {
    expect(formatDigest("Weekly", [])).toContain("Quiet week");
  });
});

import { csvCell, toCsv } from "@/lib/csv";

describe("csv", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(csvCell('He said "hi", then\nleft')).toBe('"He said ""hi"", then\nleft"');
  });
  it("neutralizes spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("-1+2")).toBe("'-1+2");
  });
  it("builds CRLF rows", () => {
    expect(toCsv(["a", "b"], [[1, null]])).toBe("a,b\r\n1,\r\n");
  });
});

import { STARTER_PACKS } from "@/lib/starter-packs";
import { competitorCreate } from "@/lib/validators";

describe("starter packs", () => {
  it("every competitor passes validation and has a unique name", () => {
    for (const p of STARTER_PACKS) {
      const names = new Set<string>();
      for (const c of p.competitors) {
        expect(() => competitorCreate.parse({ name: c.name, aliases: c.aliases, tier: c.tier, website: c.website })).not.toThrow();
        expect(names.has(c.name)).toBe(false);
        names.add(c.name);
        expect(c.aliases.every((a) => a === a.toLowerCase())).toBe(true);
      }
      for (const s of p.marketSources) expect(() => new URL(s.url)).not.toThrow();
    }
  });
  it("shared carriers keep one identity across packs", () => {
    const byName = new Map<string, string[]>();
    for (const p of STARTER_PACKS) for (const c of p.competitors) byName.set(c.name, [...(byName.get(c.name) ?? []), p.id]);
    expect(byName.get("Point32Health")?.length).toBe(4); // MA, NH, ME, RI
    expect(byName.get("UnitedHealthcare")?.length).toBe(5);
    expect(STARTER_PACKS.map((p) => p.id)).toEqual(["ma-commercial-payers", "nh-commercial-payers", "me-commercial-payers", "ri-commercial-payers", "national-payers"]);
  });
  it("source URLs are unique within each pack", () => {
    for (const p of STARTER_PACKS) {
      const urls = [...p.competitors.map((c) => c.query), ...p.marketSources.map((s) => s.url)];
      expect(new Set(urls).size).toBe(urls.length);
    }
  });
  it("attributes common headlines to the right MA plan", () => {
    const comps = STARTER_PACKS[0].competitors.map((c, i) => ({ id: String(i), name: c.name, aliases: c.aliases }));
    const who = (t: string) => STARTER_PACKS[0].competitors[Number(matchCompetitor(t, comps))]?.name;
    expect(who("Harvard Pilgrim to cut 200 jobs")).toBe("Point32Health");
    expect(who("BCBSMA posts operating loss")).toBe("Blue Cross Blue Shield of Massachusetts");
    expect(who("Optum buys physician group")).toBe("UnitedHealthcare");
  });
});

import { bingFallback, politely } from "@/lib/ingest";

describe("feed politeness", () => {
  it("maps Google News searches to Bing News with the same query", () => {
    const g = "https://news.google.com/rss/search?q=%22Harvard%20Pilgrim%22%20OR%20%22Tufts%22&hl=en-US&gl=US&ceid=US:en";
    expect(bingFallback(g)).toBe("https://www.bing.com/news/search?format=rss&q=%22Harvard%20Pilgrim%22%20OR%20%22Tufts%22");
    expect(bingFallback("https://kffhealthnews.org/feed/")).toBeNull();
  });
  it("spaces requests to the same host and runs them in order", async () => {
    const t: number[] = [];
    const t0 = Date.now();
    await Promise.all([1, 2, 3].map(() => politely("https://www.bing.com/x", async () => { t.push(Date.now() - t0); })));
    expect(t[1] - t[0]).toBeGreaterThanOrEqual(1900);
    expect(t[2] - t[1]).toBeGreaterThanOrEqual(1900);
  }, 10_000);
  it("does not block different hosts on each other", async () => {
    const t0 = Date.now();
    await politely("https://a.example/x", async () => {});
    await politely("https://b.example/x", async () => {});
    expect(Date.now() - t0).toBeLessThan(400);
  });
});

import { textOf } from "@/lib/ingest";

describe("feed field coercion", () => {
  it("handles strings, attribute objects, arrays and nulls", () => {
    expect(textOf("Plain")).toBe("Plain");
    expect(textOf({ _: "CMS finalizes rule", $: { type: "html" } })).toBe("CMS finalizes rule");
    expect(textOf(["first", "second"])).toBe("first");
    expect(textOf(undefined)).toBe("");
    expect(textOf(2027)).toBe("2027");
  });
});

import { linkOf } from "@/lib/ingest";

describe("malformed feeds (CMS)", () => {
  const cmsItem = {
    title: { a: [{ _: "CMS Finalizes Home Health Rule", $: { href: "/newsroom/press-releases/hh-rule", hreflang: "en" } }] },
    link: "https://www.cms.gov/%3Ca%20href%3D%22/newsroom/press-releases/hh-rule%22%20hreflang%3D%22en%22%3ECMS%20Finalizes%3C/a%3E",
  };
  it("reads the headline out of an embedded anchor", () => {
    expect(textOf(cmsItem.title)).toBe("CMS Finalizes Home Health Rule");
  });
  it("repairs the link to the real article URL", () => {
    expect(linkOf(cmsItem, "https://www.cms.gov/newsroom/rss-feeds")).toBe("https://www.cms.gov/newsroom/press-releases/hh-rule");
  });
  it("leaves normal links alone and resolves relative ones", () => {
    expect(linkOf({ link: "https://x.com/a?b=1" }, "https://feed.example/rss")).toBe("https://x.com/a?b=1");
    expect(linkOf({ link: "/news/1" }, "https://feed.example/rss")).toBe("https://feed.example/news/1");
  });
});

import { issuerPatternFor, validatePattern, weighted, lossRatio } from "@/lib/marketdata/queries";
import { cleanName, num, usDate } from "@/lib/marketdata/import";

describe("market data helpers", () => {
  it("uses curated patterns for known carriers and safe fallbacks otherwise", () => {
    expect(issuerPatternFor({ name: "Point32Health", aliases: [], issuerPattern: null })).toContain("harvard pilgrim");
    expect(issuerPatternFor({ name: "Point32Health", aliases: [], issuerPattern: "custom" })).toBe("custom");
    const fb = issuerPatternFor({ name: "Acme Health Plan", aliases: ["acme", "acme health"], issuerPattern: null });
    expect(new RegExp(fb, "i").test("Acme Health Plan of Vermont, Inc.")).toBe(true);
    expect(fb.split("|")).not.toContain("acme"); // short aliases skipped
  });
  it("matches the real legal names of New England carriers", () => {
    const re = (n: string) => new RegExp(issuerPatternFor({ name: n, aliases: [], issuerPattern: null }), "i");
    expect(re("Point32Health").test("HPHC Insurance Company, Inc.")).toBe(true);
    expect(re("Point32Health").test("Tufts Associated Health Maintenance Organization, Inc.")).toBe(true);
    expect(re("Elevance Health (Anthem)").test("Matthew Thornton Health Plan, Inc.")).toBe(true);
    expect(re("Cigna").test("Connecticut General Life Insurance Company")).toBe(true);
    expect(re("Blue Cross & Blue Shield of Rhode Island").test("Blue Cross Blue Shield of Massachusetts, Inc.")).toBe(false);
  });
  it("rejects invalid or match-everything patterns", () => {
    expect(validatePattern("(")).toMatch(/Invalid/);
    expect(validatePattern(".*")).toMatch(/everything/);
    expect(validatePattern("harvard pilgrim|hphc")).toBeNull();
  });
  it("weights by enrollment, falls back to simple mean, ignores nulls", () => {
    expect(weighted([{ v: 0.1, w: 900 }, { v: 0.5, w: 100 }])).toBeCloseTo(0.14);
    expect(weighted([{ v: 0.1, w: 0 }, { v: 0.3, w: 0 }])).toBeCloseTo(0.2);
    expect(weighted([{ v: null, w: 5 }])).toBeNull();
  });
  it("suppresses loss ratios on trivial premium", () => {
    expect(lossRatio(5000, 2000)).toBeNull();
    expect(lossRatio(925, 1000 * 1000)).toBeCloseTo(0.000925);
  });
  it("parses CMS CSV quirks", () => {
    expect(cleanName('"HMO Blue NE \\"Premier Value\\" Plan"')).toBe('HMO Blue NE "Premier Value" Plan');
    expect(usDate("01/01/2026").toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(num("1,234.5")).toBe(1234.5);
    expect(num("")).toBeNull();
  });
});

import { isStale, withRecency, mentions } from "@/lib/relevance";

describe("feed hygiene", () => {
  it("drops articles older than 30 days, keeps undated and fresh ones", () => {
    const now = Date.UTC(2026, 10, 4);
    expect(isStale(new Date(Date.UTC(2023, 5, 15)), now)).toBe(true);
    expect(isStale(new Date(Date.UTC(2026, 10, 1)), now)).toBe(false);
    expect(isStale(null, now)).toBe(false);
  });
  it("adds Google News recency once, leaves other feeds alone", () => {
    const g = "https://news.google.com/rss/search?q=%22Fallon+Health%22&hl=en-US";
    const r = withRecency(g);
    expect(new URL(r).searchParams.get("q")).toBe('"Fallon Health" when:30d');
    expect(withRecency(r)).toBe(r);
    expect(withRecency("https://kffhealthnews.org/feed/")).toBe("https://kffhealthnews.org/feed/");
  });
  it("Bing fallback strips Google's when: operator", () => {
    const r = withRecency("https://news.google.com/rss/search?q=%22Fallon+Health%22");
    expect(decodeURIComponent(bingFallback(r)!)).not.toContain("when:");
  });
  it("relevance: requires the competitor to be named", () => {
    const aetna = { id: "a", name: "Aetna", aliases: ["aetna", "cvs health", "cvs"] };
    expect(mentions("CVS to split off drugstore business", aetna)).toBe(true);
    expect(mentions("Best Medicare Advantage Plans In Rhode Island 2027 - Forbes", aetna)).toBe(false);
    expect(mentions("CVSHealthy snacks recall", aetna)).toBe(false); // whole word only
  });
});

import { readFileSync } from "node:fs";
import { CHIA_PAYERS, chiaSegment, chiaFunding } from "@/lib/marketdata/state";

const snap = (f: string) => JSON.parse(readFileSync(`data/state-large-group/${f}`, "utf8"));

describe("state large-group snapshots (guards against transcription errors)", () => {
  it("Maine: every row balances — gain = premium − claims − reserves − admin", () => {
    for (const r of snap("me-boi.json").rows) {
      const calc = r.premium - r.claims - (r.reserveChange ?? 0) - (r.adminExpense ?? 0);
      expect(Math.abs(calc - r.underwritingGain), `${r.company} ${r.year}`).toBeLessThanOrEqual(2);
    }
  });
  it("Maine: carriers sum to the published grand totals", () => {
    const rows = snap("me-boi.json").rows;
    for (const y of [2023, 2024, 2025]) {
      const total = rows.find((r: any) => r.isTotal && r.year === y);
      const parts = rows.filter((r: any) => !r.isTotal && r.year === y);
      for (const k of ["premium", "claims", "adminExpense", "underwritingGain"])
        expect(Math.abs(parts.reduce((s: number, r: any) => s + (r[k] ?? 0), 0) - total[k]), `${k} ${y}`).toBeLessThanOrEqual(5);
      expect(parts.reduce((s: number, r: any) => s + (r.coveredLives ?? 0), 0)).toBe(total.coveredLives);
    }
  });
  it("Rhode Island: members reconcile and the weighted average matches the printed total", () => {
    const acts = snap("ri-ohic.json").actions;
    for (const y of [2026, 2027]) {
      const t = acts.find((a: any) => a.isTotal && a.planYear === y);
      const parts = acts.filter((a: any) => !a.isTotal && a.planYear === y);
      expect(Math.abs(parts.reduce((s: number, a: any) => s + a.members, 0) - t.members)).toBeLessThanOrEqual(1);
      const w = parts.reduce((s: number, a: any) => s + a.approved * a.members, 0) / parts.reduce((s: number, a: any) => s + a.members, 0);
      expect(Math.abs(w - t.approved), `approved ${y}`).toBeLessThan(0.002);
    }
  });
  it("New Hampshire: published shares sum to 100% per year and funding type", () => {
    const by = new Map<string, number>();
    for (const r of snap("nh-nhid.json").rows) by.set(`${r.year}${r.funding}`, (by.get(`${r.year}${r.funding}`) ?? 0) + r.sharePct);
    for (const v of by.values()) expect(v).toBe(100);
  });
  it("every carrier in every state source maps to exactly one starter-pack competitor", () => {
    const comps = STARTER_PACKS.flatMap((p) => p.competitors).filter((c, i, a) => a.findIndex((x) => x.name === c.name) === i);
    const names = [
      ...snap("me-boi.json").rows.filter((r: any) => !r.isTotal && !/all other/i.test(r.company)).map((r: any) => r.company),
      ...snap("ri-ohic.json").actions.filter((a: any) => !a.isTotal).map((a: any) => a.carrier),
      ...snap("nh-nhid.json").rows.map((r: any) => r.payer),
      ...Object.values(CHIA_PAYERS),
    ];
    for (const n of new Set(names)) {
      const hits = comps.filter((c) => new RegExp(issuerPatternFor({ ...c, issuerPattern: c.issuerPattern ?? null }), "i").test(n));
      expect(hits.map((h) => h.name), n).toHaveLength(1);
    }
  });
  it("CHIA sectors and funding map correctly (51–100 is large group in MA)", () => {
    expect(chiaSegment("Mid-Size Group (51-100)")).toBe("LARGE_GROUP");
    expect(chiaSegment("Jumbo-Size Group (501+)")).toBe("LARGE_GROUP");
    expect(chiaSegment("Small Group (1-50)")).toBe("SMALL_GROUP");
    expect(chiaSegment("Other")).toBeNull();
    expect(chiaFunding("Self-Insured")).toBe("SELF_INSURED");
  });
});

import { fundingFor, NON_MAJOR_MEDICAL } from "@/lib/marketdata/dol";
import { sectorOf } from "@/lib/marketdata/employers";

describe("Form 5500 employer plans", () => {
  it("classifies funding from contracts and plan arrangement", () => {
    expect(fundingFor({ benefitAssets: false }, [{ premium: 1_000_000 }], false)).toBe("insured");
    expect(fundingFor({ benefitAssets: true }, [], false)).toBe("self-funded");
    expect(fundingFor({ benefitAssets: false }, [{ premium: 0 }], false)).toBe("self-funded"); // ASO-style schedule, no premium
    expect(fundingFor({ benefitAssets: true }, [{ premium: 5e5 }], true)).toBe("mixed");
    // CVS-style: one small insured HMO contract, 300K participants, benefits from general assets
    expect(fundingFor({ benefitAssets: true, participants: 300_000 }, [{ premium: 2e5, personsCovered: 900 }], false)).toBe("mixed");
    expect(fundingFor({ benefitAssets: true, participants: 1000 }, [{ premium: 9e6, personsCovered: 950 }], false)).toBe("insured");
    expect(fundingFor({ benefitAssets: false }, [], false)).toBe("unknown");
  });
  it("drops non-major-medical carriers that tick the health box", () => {
    expect(NON_MAJOR_MEDICAL.test("METROPOLITAN LIFE INSURANCE COMPANY")).toBe(true);
    expect(NON_MAJOR_MEDICAL.test("DELTA DENTAL OF MASSACHUSETTS")).toBe(true);
    expect(NON_MAJOR_MEDICAL.test("BLUE CROSS BLUE SHIELD OF MASSACHUSETTS, INC.")).toBe(false);
    expect(NON_MAJOR_MEDICAL.test("HARVARD PILGRIM HEALTH CARE")).toBe(false);
  });
  it("maps NAICS codes to sectors", () => {
    expect(sectorOf("622000")).toBe("Health care");
    expect(sectorOf("524210")).toBe("Finance & insurance");
    expect(sectorOf(null)).toBe("Unknown");
  });
});
