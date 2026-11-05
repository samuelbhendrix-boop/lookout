import type { Segment } from "@prisma/client";
import { db } from "../db";
import { CURATED_ISSUER_PATTERNS } from "../starter-packs";

// ─── competitor ↔ legal entity matching ──────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Regex (case-insensitive) matched against legal company names in CMS filings.
 * Priority: explicit pattern → curated pattern for known carriers → name + long aliases.
 * Short aliases ("uhc", "nwh") are skipped — too likely to match unrelated companies.
 */
export function issuerPatternFor(c: { name: string; aliases: string[]; issuerPattern: string | null }): string {
  if (c.issuerPattern?.trim()) return c.issuerPattern.trim();
  if (CURATED_ISSUER_PATTERNS[c.name]) return CURATED_ISSUER_PATTERNS[c.name];
  const terms = [c.name, ...c.aliases].map((t) => t.trim()).filter((t) => t.length >= 5);
  return [...new Set(terms.map((t) => escapeRe(t.toLowerCase())))].join("|");
}

/** Validates a user-supplied pattern: must compile, be bounded, and not match everything. */
export function validatePattern(p: string): string | null {
  if (p.length > 300) return "Pattern too long (max 300 characters)";
  try {
    const re = new RegExp(p, "i");
    if (re.test("") || re.test("zzzz unrelated insurance company")) return "Pattern matches everything — make it more specific";
  } catch (e) {
    return `Invalid pattern: ${(e as Error).message}`;
  }
  return null;
}

// ─── types ───────────────────────────────────────────────────────────

export type SegmentYear = {
  year: number;
  segment: Segment;
  premium: number;
  claims: number;
  coveredLives: number;
  memberMonths: number;
  brokerFees: number;
  lossRatio: number | null;
  premiumPmpm: number | null;
};

export type ProductSummary = {
  key: string;
  state: string;
  market: string;
  productId: string;
  productName: string;
  company: string;
  planType: string | null;
  planYear: number;
  plans: Array<{
    planId: string; planName: string; metal: string | null; category: string; onExchange: boolean;
    rateChange: number | null; enrollment: number | null; ratePmpm: number | null; effectiveDate: Date;
  }>;
  activePlans: number;
  newPlans: number;
  terminatedPlans: number;
  enrollment: number;
  avgRateChange: number | null; // enrollment-weighted over renewing plans
  avgPremiumPmpm: number | null; // enrollment-weighted current rate
  onExchangePlans: number;
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** Below this premium a loss ratio is noise (run-off entities report a few dollars of claims). */
export const MIN_PREMIUM_FOR_LR = 250_000;
export const lossRatio = (claims: number, premium: number) => (premium >= MIN_PREMIUM_FOR_LR ? claims / premium : null);

/** Enrollment-weighted mean, ignoring nulls; falls back to simple mean if nobody is enrolled. */
export function weighted(items: Array<{ v: number | null; w: number | null }>): number | null {
  const xs = items.filter((i) => i.v !== null && Number.isFinite(i.v)) as Array<{ v: number; w: number | null }>;
  if (!xs.length) return null;
  const tw = xs.reduce((s, i) => s + (i.w ?? 0), 0);
  if (tw > 0) return xs.reduce((s, i) => s + i.v * (i.w ?? 0), 0) / tw;
  return xs.reduce((s, i) => s + i.v, 0) / xs.length;
}

// ─── competitor profile ──────────────────────────────────────────────

export async function competitorProfile(c: { name: string; aliases: string[]; issuerPattern: string | null }, state?: string) {
  const pattern = issuerPatternFor(c);
  const st = state && /^[A-Z]{2}$/.test(state) ? state : null;

  const fin = await db.$queryRaw<Array<Omit<SegmentYear, "lossRatio" | "premiumPmpm">>>`
    SELECT year, segment::text AS segment,
           SUM(premium)::float AS premium, SUM(claims)::float AS claims,
           SUM("coveredLives")::float AS "coveredLives", SUM("memberMonths")::float AS "memberMonths",
           SUM("brokerFees")::float AS "brokerFees"
    FROM "MarketFinancial"
    WHERE company ~* ${pattern} AND (${st}::text IS NULL OR state = ${st})
    GROUP BY year, segment ORDER BY year, segment`;
  const performance: SegmentYear[] = fin.map((r) => ({
    ...r,
    lossRatio: lossRatio(r.claims, r.premium),
    premiumPmpm: ratio(r.premium, r.memberMonths),
  }));

  const entities = await db.$queryRaw<Array<{ state: string; company: string; source: string }>>`
    SELECT DISTINCT state, company, 'financials' AS source FROM "MarketFinancial" WHERE company ~* ${pattern} AND (${st}::text IS NULL OR state = ${st})
    UNION
    SELECT DISTINCT state, company, 'filings' AS source FROM "RateFiling" WHERE company ~* ${pattern} AND (${st}::text IS NULL OR state = ${st})
    ORDER BY state, company`;
  const states = [...new Set(entities.map((e) => e.state))].sort();

  // Products: latest plan year; latest filing version of each plan (quarterly refilings collapse).
  const latest = await db.$queryRaw<Array<{ y: number | null }>>`
    SELECT MAX("planYear") AS y FROM "RatePlan" WHERE company ~* ${pattern} AND (${st}::text IS NULL OR state = ${st})`;
  const planYear = latest[0]?.y ?? null;
  const planRows = planYear
    ? await db.$queryRaw<Array<{
        state: string; market: string; productId: string; productName: string; company: string; planType: string | null;
        planId: string; planName: string; metal: string | null; category: string; onExchange: boolean;
        rateChange: number | null; enrollment: number | null; ratePmpm: number | null; effectiveDate: Date;
      }>>`
        SELECT DISTINCT ON ("planId") state, market, "productId", "productName", company, "planType", "planId", "planName",
               metal, category, "onExchange", "rateChange", enrollment, "ratePmpm", "effectiveDate"
        FROM "RatePlan"
        WHERE "planYear" = ${planYear} AND company ~* ${pattern} AND (${st}::text IS NULL OR state = ${st})
        ORDER BY "planId", "effectiveDate" DESC`
    : [];
  const byProduct = new Map<string, ProductSummary>();
  for (const r of planRows) {
    const key = `${r.state}|${r.market}|${r.productId}`;
    const p = byProduct.get(key) ?? {
      key, state: r.state, market: r.market, productId: r.productId, productName: r.productName, company: r.company,
      planType: r.planType, planYear: planYear!, plans: [], activePlans: 0, newPlans: 0, terminatedPlans: 0, enrollment: 0,
      avgRateChange: null, avgPremiumPmpm: null, onExchangePlans: 0,
    };
    p.plans.push({ planId: r.planId, planName: r.planName, metal: r.metal, category: r.category, onExchange: r.onExchange, rateChange: r.rateChange, enrollment: r.enrollment, ratePmpm: r.ratePmpm, effectiveDate: r.effectiveDate });
    byProduct.set(key, p);
  }
  for (const p of byProduct.values()) {
    const live = p.plans.filter((x) => x.category !== "Terminated");
    p.activePlans = live.length;
    p.newPlans = p.plans.filter((x) => x.category === "New").length;
    p.terminatedPlans = p.plans.length - live.length;
    p.enrollment = p.plans.reduce((s, x) => s + (x.enrollment ?? 0), 0);
    p.onExchangePlans = live.filter((x) => x.onExchange).length;
    p.avgRateChange = weighted(p.plans.filter((x) => x.category === "Renewing").map((x) => ({ v: x.rateChange, w: x.enrollment })));
    p.avgPremiumPmpm = weighted(p.plans.filter((x) => x.ratePmpm && x.ratePmpm > 0).map((x) => ({ v: x.ratePmpm, w: x.enrollment })));
    const metalOrder = ["Platinum", "Gold", "Silver", "Expanded Bronze", "Bronze", "Catastrophic"];
    p.plans.sort((a, b) => metalOrder.indexOf(a.metal ?? "") - metalOrder.indexOf(b.metal ?? "") || a.planName.localeCompare(b.planName));
  }
  const products = [...byProduct.values()].sort((a, b) => a.state.localeCompare(b.state) || a.market.localeCompare(b.market) || b.enrollment - a.enrollment);

  const filings = await db.$queryRaw<Array<{
    id: string; planYear: number; serffNumber: string | null; state: string; company: string; market: string;
    effectiveDate: Date; expPremium: number | null; expClaims: number | null; expMemberMonths: number | null;
    avgRateChange: number | null; enrollment: number | null; plans: number;
  }>>`
    SELECT f.id, f."planYear", f."serffNumber", f.state, f.company, f.market, f."effectiveDate",
           f."expPremium", f."expClaims", f."expMemberMonths",
           (SUM(p."rateChange" * p.enrollment) FILTER (WHERE p.category = 'Renewing' AND p.enrollment > 0)
             / NULLIF(SUM(p.enrollment) FILTER (WHERE p.category = 'Renewing' AND p.enrollment > 0), 0))::float AS "avgRateChange",
           SUM(p.enrollment)::int AS enrollment,
           COUNT(p.id)::int AS plans
    FROM "RateFiling" f LEFT JOIN "RatePlan" p ON p."filingId" = f.id
    WHERE f.company ~* ${pattern} AND (${st}::text IS NULL OR f.state = ${st})
    GROUP BY f.id ORDER BY f."planYear" DESC, f."effectiveDate" DESC, f.state, f.market
    LIMIT 200`;

  return { pattern, states, entities, performance, planYear, products, filings };
}

// ─── market view ─────────────────────────────────────────────────────

export type MarketRow = {
  key: string; label: string; competitorId: string | null; companies: string[];
  coveredLives: number; premium: number; claims: number; memberMonths: number;
  share: number; lossRatio: number | null; premiumPmpm: number | null; livesChange: number | null;
};

/** Market share for one state × segment × year, grouped by the workspace's competitors. */
export async function marketShare(workspaceId: string, state: string, segment: Segment, year: number) {
  const competitors = await db.competitor.findMany({
    where: { workspaceId },
    select: { id: true, name: true, aliases: true, issuerPattern: true },
  });
  const matchers = competitors.map((c) => ({ c, re: safeRegex(issuerPatternFor(c)) }));
  const [rows, prior] = await Promise.all([
    db.marketFinancial.findMany({ where: { state, segment, year } }),
    db.marketFinancial.findMany({ where: { state, segment, year: year - 1 } }),
  ]);
  const group = (company: string) => {
    const m = matchers.find((x) => x.re?.test(company));
    return m ? { key: m.c.id, label: m.c.name, competitorId: m.c.id } : { key: `co:${company}`, label: company, competitorId: null };
  };
  const agg = new Map<string, MarketRow>();
  for (const r of rows) {
    const g = group(r.company);
    const a = agg.get(g.key) ?? { ...g, companies: [], coveredLives: 0, premium: 0, claims: 0, memberMonths: 0, share: 0, lossRatio: null, premiumPmpm: null, livesChange: null };
    a.companies.push(r.company);
    a.coveredLives += r.coveredLives;
    a.premium += r.premium;
    a.claims += r.claims;
    a.memberMonths += r.memberMonths;
    agg.set(g.key, a);
  }
  const priorLives = new Map<string, number>();
  for (const r of prior) {
    const g = group(r.company);
    priorLives.set(g.key, (priorLives.get(g.key) ?? 0) + r.coveredLives);
  }
  const total = [...agg.values()].reduce((s, a) => s + a.coveredLives, 0);
  // Drop run-off entities: no members and trivial premium.
  const out = [...agg.values()].filter((a) => a.coveredLives >= 1 || a.premium >= MIN_PREMIUM_FOR_LR).map((a) => ({
    ...a,
    share: total > 0 ? a.coveredLives / total : 0,
    lossRatio: lossRatio(a.claims, a.premium),
    premiumPmpm: ratio(a.premium, a.memberMonths),
    livesChange: priorLives.get(a.key) ? a.coveredLives / priorLives.get(a.key)! - 1 : null,
  }));
  out.sort((a, b) => b.coveredLives - a.coveredLives);
  return { rows: out, total, totalPremium: out.reduce((s, a) => s + a.premium, 0) };
}

/** ACA (individual/small group) rate actions by company for a state's latest plan year. */
export async function rateActions(workspaceId: string, state: string) {
  const competitors = await db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } });
  const matchers = competitors.map((c) => ({ c, re: safeRegex(issuerPatternFor(c)) }));
  const latest = await db.ratePlan.aggregate({ where: { state }, _max: { planYear: true } });
  const planYear = latest._max.planYear;
  if (!planYear) return { planYear: null, rows: [] };
  const rows = await db.$queryRaw<Array<{ company: string; market: string; enrollment: number; avgRateChange: number | null; plans: number; newPlans: number; termed: number }>>`
    WITH latest AS (
      SELECT DISTINCT ON ("planId") company, market, category, "rateChange", enrollment
      FROM "RatePlan" WHERE state = ${state} AND "planYear" = ${planYear}
      ORDER BY "planId", "effectiveDate" DESC
    )
    SELECT company, market,
           COALESCE(SUM(enrollment), 0)::int AS enrollment,
           (SUM("rateChange" * enrollment) FILTER (WHERE category = 'Renewing' AND enrollment > 0)
             / NULLIF(SUM(enrollment) FILTER (WHERE category = 'Renewing' AND enrollment > 0), 0))::float AS "avgRateChange",
           COUNT(*) FILTER (WHERE category <> 'Terminated')::int AS plans,
           COUNT(*) FILTER (WHERE category = 'New')::int AS "newPlans",
           COUNT(*) FILTER (WHERE category = 'Terminated')::int AS termed
    FROM latest GROUP BY company, market ORDER BY market, enrollment DESC`;
  return {
    planYear,
    rows: rows.map((r) => {
      const m = matchers.find((x) => x.re?.test(r.company));
      return { ...r, competitorId: m?.c.id ?? null, competitorName: m?.c.name ?? null };
    }),
  };
}

function safeRegex(p: string): RegExp | null {
  try {
    return p ? new RegExp(p, "i") : null;
  } catch {
    return null;
  }
}

export async function availableYears() {
  const [fin, plans] = await Promise.all([
    db.marketFinancial.groupBy({ by: ["year"], orderBy: { year: "desc" } }),
    db.ratePlan.groupBy({ by: ["planYear"], orderBy: { planYear: "desc" } }),
  ]);
  return { financialYears: fin.map((f) => f.year), planYears: plans.map((p) => p.planYear) };
}
