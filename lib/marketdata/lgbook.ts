import { db } from "../db";
import { issuerPatternFor, marketShare } from "./queries";
import { canonicalCarrier } from "./events";

/**
 * Large group (51+ / 101+ employees) has no public plan-design filings: carriers don't file large-group rates or
 * benefits with CMS, and most New England states don't rate-review them. What is public, and combined here:
 *  - CMS MLR reports: fully insured large-group lives, premium and claims per member per month, loss ratio, by carrier and state.
 *  - MA CHIA enrollment and NH Insurance Dept reports: large-group members by carrier, fully vs self-insured, and (MA) by product type.
 *  - DOL Form 5500 Schedule A: each fully insured employer's carrier, persons covered, premium and broker pay → pricing per
 *    covered person by employer size, and renewal changes for the same employer with the same carrier year over year.
 *  - RI OHIC large-group rate review: requested vs approved rate change with trend and retention components.
 *  - Maine Bureau of Insurance: large-group admin expense and underwriting gain.
 */

export const SIZE_BANDS = [
  { label: "100–249", min: 0, max: 249 },
  { label: "250–999", min: 250, max: 999 },
  { label: "1,000+", min: 1000, max: Infinity },
];
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const safe = (p: string) => { try { return p ? new RegExp(p, "i") : null; } catch { return null; } };

export type LgRow = {
  key: string; label: string; competitorId: string | null;
  // MLR (fully insured)
  lives: number | null; share: number | null; livesChange: number | null; premiumPmpm: number | null; pmpmChange: number | null; claimsPmpm: number | null; lossRatio: number | null;
  // Enrollment reports
  selfInsured: number | null; fullyInsured: number | null; products: Record<string, number>;
  // Form 5500
  accounts: number; persons: number; premPerPerson: number | null; p25: number | null; p75: number | null; byBand: Array<number | null>;
  renewal: number | null; renewals: number; brokerPct: number | null; hmoShare: number | null;
  // Regulators
  rate: { year: number; requested: number | null; approved: number | null; members: number | null; trend: number | null; retention: number | null } | null;
  admin: { year: number; adminPct: number | null; marginPct: number | null } | null;
};

export async function largeGroupMarket(workspaceId: string, state: string) {
  const competitors = await db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } });
  const matchers = competitors.map((c) => ({ c, re: safe(issuerPatternFor(c)) }));
  const groupOf = (name: string) => {
    const m = matchers.find((x) => x.re?.test(name));
    if (m) return { key: m.c.id, label: m.c.name, competitorId: m.c.id as string | null };
    const canon = canonicalCarrier(name);
    return canon ? { key: `co:${canon}`, label: canon, competitorId: null } : null;
  };
  const rows = new Map<string, LgRow>();
  const row = (name: string, allowUnknown = false): LgRow | null => {
    const g = groupOf(name) ?? (allowUnknown ? { key: `co:${name}`, label: name, competitorId: null } : null);
    if (!g) return null;
    return rows.get(g.key) ?? rows.set(g.key, {
      ...g, lives: null, share: null, livesChange: null, premiumPmpm: null, pmpmChange: null, claimsPmpm: null, lossRatio: null,
      selfInsured: null, fullyInsured: null, products: {}, accounts: 0, persons: 0, premPerPerson: null, p25: null, p75: null, byBand: [],
      renewal: null, renewals: 0, brokerPct: null, hmoShare: null, rate: null, admin: null,
    }).get(g.key)!;
  };

  // ── MLR: fully insured large group.
  const mlrYear = (await db.marketFinancial.aggregate({ where: { state, segment: "LARGE_GROUP" }, _max: { year: true } }))._max.year;
  if (mlrYear) {
    const [now, prev] = await Promise.all([marketShare(workspaceId, state, "LARGE_GROUP", mlrYear), marketShare(workspaceId, state, "LARGE_GROUP", mlrYear - 1)]);
    for (const m of now.rows) {
      const r = row(m.companies[0], true)!;
      const p = prev.rows.find((x) => x.key === m.key);
      Object.assign(r, { lives: (r.lives ?? 0) + m.coveredLives, share: (r.share ?? 0) + m.share, livesChange: m.livesChange, premiumPmpm: m.premiumPmpm, claimsPmpm: m.memberMonths ? m.claims / m.memberMonths : null, lossRatio: m.lossRatio, pmpmChange: p?.premiumPmpm && m.premiumPmpm ? m.premiumPmpm / p.premiumPmpm - 1 : null });
    }
  }

  // ── Enrollment reports: fully vs self-insured, product mix (latest report date).
  const enrollAsOf = (await db.marketEnrollment.aggregate({ where: { state, segment: "LARGE_GROUP" }, _max: { asOf: true } }))._max.asOf;
  if (enrollAsOf) {
    for (const e of await db.marketEnrollment.findMany({ where: { state, segment: "LARGE_GROUP", asOf: enrollAsOf } })) {
      const r = row(e.payer, true)!;
      if (e.funding === "SELF_INSURED") r.selfInsured = (r.selfInsured ?? 0) + e.members; else r.fullyInsured = (r.fullyInsured ?? 0) + e.members;
      if (e.productType) r.products[e.productType] = (r.products[e.productType] ?? 0) + e.members;
    }
  }

  // ── Form 5500 Schedule A: fully insured employers headquartered in the state, last two filing years.
  const years = (await db.employerPlan.findMany({ where: { state }, select: { formYear: true }, distinct: ["formYear"], orderBy: { formYear: "desc" }, take: 3 })).map((y) => y.formYear);
  const contracts = years.length ? await db.employerContract.findMany({
    where: { kind: "health", premium: { gt: 0 }, personsCovered: { gte: 50 }, plan: { state, formYear: { in: years } } },
    select: { carrier: true, premium: true, personsCovered: true, brokerComm: true, brokerFees: true, hmo: true, ppo: true, plan: { select: { ein: true, planNum: true, formYear: true } } },
  }) : [];
  const latestYears = new Set(years.slice(0, 2));
  const per = new Map<string, { ppp: number[]; bands: number[][]; persons: number; accounts: Set<string>; broker: number[]; hmo: number; typed: number; series: Map<string, Map<number, number>> }>();
  for (const c of contracts) {
    const g = groupOf(c.carrier);
    if (!g) continue;
    const ppp = c.premium! / c.personsCovered!;
    if (ppp < 1000 || ppp > 60000) continue; // misfiled units (monthly premium, dental-only, totals)
    const a = per.get(g.key) ?? per.set(g.key, { ppp: [], bands: SIZE_BANDS.map(() => []), persons: 0, accounts: new Set(), broker: [], hmo: 0, typed: 0, series: new Map() }).get(g.key)!;
    const acct = `${c.plan.ein}|${c.plan.planNum}`;
    (a.series.get(acct) ?? a.series.set(acct, new Map()).get(acct)!).set(c.plan.formYear, ppp);
    if (!latestYears.has(c.plan.formYear)) continue;
    row(c.carrier);
    a.ppp.push(ppp);
    a.bands[SIZE_BANDS.findIndex((b) => c.personsCovered! >= b.min && c.personsCovered! <= b.max)].push(ppp);
    a.persons += c.personsCovered!;
    a.accounts.add(acct);
    const comm = (c.brokerComm ?? 0) + (c.brokerFees ?? 0);
    if (comm > 0) a.broker.push(comm / c.premium!);
    if (c.hmo || c.ppo) { a.typed++; if (c.hmo) a.hmo++; }
  }
  const allChanges: number[] = [];
  for (const [key, a] of per) {
    const r = rows.get(key);
    if (!r || !a.ppp.length) continue;
    const changes: number[] = [];
    for (const s of a.series.values()) for (const [y, v] of s) { const before = s.get(y - 1); if (before && latestYears.has(y)) { const ch = v / before - 1; if (ch > -0.5 && ch < 1) { changes.push(ch); allChanges.push(ch); } } }
    Object.assign(r, {
      accounts: a.accounts.size, persons: a.persons, premPerPerson: median(a.ppp), p25: pct(a.ppp, 0.25), p75: pct(a.ppp, 0.75),
      byBand: a.bands.map((b) => (b.length >= 3 ? median(b) : null)), renewal: changes.length >= 3 ? median(changes) : null, renewals: changes.length,
      brokerPct: a.broker.length >= 3 ? median(a.broker) : null, hmoShare: a.typed >= 3 ? a.hmo / a.typed : null,
    });
  }

  // ── Regulators.
  const rateYear = (await db.groupRateAction.aggregate({ where: { state, segment: "LARGE_GROUP" }, _max: { planYear: true } }))._max.planYear;
  if (rateYear) for (const a of await db.groupRateAction.findMany({ where: { state, segment: "LARGE_GROUP", planYear: rateYear, isTotal: false } })) {
    const r = row(a.carrier, true)!;
    const d = (a.details ?? {}) as Record<string, number>;
    r.rate = { year: rateYear, requested: a.requested, approved: a.approved, members: a.members, trend: d.medicalTrendTotal ?? null, retention: d.totalRetention ?? null };
  }
  const finYear = (await db.stateFinancial.aggregate({ where: { state, segment: "LARGE_GROUP" }, _max: { year: true } }))._max.year;
  if (finYear) for (const f of await db.stateFinancial.findMany({ where: { state, segment: "LARGE_GROUP", year: finYear, isTotal: false } })) {
    const r = row(f.company, true)!;
    r.admin = { year: finYear, adminPct: f.adminExpense != null && f.premium ? f.adminExpense / f.premium : null, marginPct: f.underwritingGain != null && f.premium ? f.underwritingGain / f.premium : null };
  }

  const out = [...rows.values()].filter((r) => (r.lives ?? 0) >= 100 || (r.selfInsured ?? 0) + (r.fullyInsured ?? 0) >= 100 || r.accounts >= 3 || r.rate || r.admin)
    .sort((a, b) => ((b.lives ?? b.fullyInsured ?? 0) + (b.selfInsured ?? 0)) - ((a.lives ?? a.fullyInsured ?? 0) + (a.selfInsured ?? 0)));
  const all = contracts.filter((c) => latestYears.has(c.plan.formYear)).map((c) => c.premium! / c.personsCovered!).filter((v) => v >= 1000 && v <= 60000);
  return {
    state, rows: out, mlrYear, enrollAsOf, formYears: [...latestYears].sort(), rateYear, finYear,
    marketPremPerPerson: median(all),
    marketRenewal: allChanges.length >= 5 ? median(allChanges) : null,
  };
}

// ── Product lines from carriers' Transparency in Coverage indexes ────────────────────────────────────────────────
// Group plan names carry the product: "AERODYNE RESEARCH INC COMPLETE HMO HSA 5000 10% ENHANCED FLEXRX". The family is
// the longest run of words ending in the plan type (HMO/PPO/POS/EPO/OAP…) that recurs across 3+ different plans, so
// employer names drop out and real product names ("COMPLETE PPO PLUS", "CHOICE EASY TIER HMO") stay.

const TYPE = /^(HMO|PPO|POS|EPO|OAP|HDHP|INDEMNITY|OPEN ACCESS)$/;
const AFTER = new Set(["PLUS", "HSA", "SELECT", "OPEN", "ACCESS", "HRA"]);
const NOT_PRODUCT = new Set(["INC", "LLC", "CORP", "CO", "COMPANY", "CORPORATION", "LTD", "LP", "LLP", "PC", "PLLC", "THE", "OF", "AND", "UNIVERSITY", "COLLEGE", "SCHOOL", "SCHOOLS", "TOWN", "CITY", "HOSPITAL", "GROUP", "TRUST", "FUND", "PLAN", "HEALTH", "ACCT", "HOUSE", "&"]);
const FEATURES: Array<{ label: string; re: RegExp }> = [
  { label: "HSA-eligible", re: /\bHSA\b/i },
  { label: "Tiered network", re: /\bTIER(ED)?\b/i },
  { label: "Limited network", re: /\b(LIMITED|SELECT|FOCUS|LOCAL|VALUE|ALLIES|NARROW)\b/i },
  { label: "Out-of-area", re: /OUT OF AREA|ACCESS AMERICA|NATIONAL/i },
  { label: "Coinsurance", re: /\d+%/ },
];

/** Candidate families for one plan name (shortest first). */
export function familyCandidates(raw: string): string[] {
  const w = raw.toUpperCase().replace(/[^A-Z0-9%/&. ]+/g, " ").split(/\s+/).filter(Boolean);
  const i = w.findIndex((x, k) => TYPE.test(x) || (x === "OPEN" && w[k + 1] === "ACCESS"));
  if (i < 0) return [];
  let end = i + (w[i] === "OPEN" ? 2 : 1);
  while (end < w.length && AFTER.has(w[end])) end++;
  const out: string[] = [w.slice(i, end).join(" ")];
  for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
    if (NOT_PRODUCT.has(w[k]) || /\d/.test(w[k]) || w[k].length < 2) break;
    out.push(w.slice(k, end).join(" "));
  }
  return out;
}

export function deductibleOf(raw: string): number | null {
  for (const m of raw.matchAll(/\b(\d{3,5})\b/g)) { const v = Number(m[1]); if (v >= 250 && v <= 10000 && v % 50 === 0) return v; }
  return null;
}

export type ProductLine = { family: string; plans: number; deductibles: number[]; features: string[]; examples: string[] };

export function productLines(names: string[]): ProductLine[] {
  const uniq = [...new Set(names.map((n) => n.replace(/\s+/g, " ").trim()))];
  const cands = uniq.map((n) => ({ n, c: familyCandidates(n) }));
  const freq = new Map<string, number>();
  for (const { c } of cands) for (const f of c) freq.set(f, (freq.get(f) ?? 0) + 1);
  const lines = new Map<string, ProductLine>();
  for (const { n, c } of cands) {
    const family = [...c].reverse().find((f) => (freq.get(f) ?? 0) >= 3) ?? c[0] ?? "Other";
    const l = lines.get(family) ?? lines.set(family, { family, plans: 0, deductibles: [], features: [], examples: [] }).get(family)!;
    l.plans++;
    const d = deductibleOf(n); if (d) l.deductibles.push(d);
    for (const f of FEATURES) if (f.re.test(n) && !l.features.includes(f.label)) l.features.push(f.label);
    if (l.examples.length < 3) l.examples.push(n);
  }
  return [...lines.values()].sort((a, b) => b.plans - a.plans);
}

/** A carrier's group product line-up from its transparency index. */
export async function groupProductLines(pattern: string) {
  const rows = await db.$queryRaw<Array<{ planName: string }>>`
    SELECT DISTINCT "planName" FROM "PlanAdministration" WHERE "marketType" = 'group' AND (carrier ~* ${pattern} OR "reportingEntity" ~* ${pattern}) LIMIT 5000`;
  return { total: rows.length, lines: productLines(rows.map((r) => r.planName)) };
}
