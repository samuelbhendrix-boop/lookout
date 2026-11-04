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
