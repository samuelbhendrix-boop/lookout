import { db } from "./db";
import { issuerPatternFor } from "./marketdata/queries";
import { sectorOf } from "./marketdata/employers";
import { GIC_YEARS } from "./marketdata/gic";
import { ARCHETYPES, type Marketing } from "./marketing/extract";
import { siteFor } from "./marketing/sites";

/**
 * Competitors → Data table: a pivot table over everything the site holds. Each dataset is a flat list of facts (one
 * row per plan, filing, employer contract, enrollment count…) with dimensions (text) and numeric fields. The client
 * filters, groups by any dimensions on rows and one on columns, and aggregates any measures. Ratio measures (loss
 * ratio, premium per member) are computed as sum ÷ sum in every cell, so they stay correct at any level of grouping.
 */
export const NE = ["MA", "CT", "RI", "NH", "VT", "ME"];
export type Fmt = "int" | "usd" | "usd0" | "pct" | "x" | "num";
export type Agg = "sum" | "avg" | "wavg" | "min" | "max" | "median" | "count" | "distinct" | "ratio";
export type Dim = { key: string; label: string; group: string; hint?: string; values: string[]; numeric?: boolean };
export type Measure = { key: string; label: string; group: string; fmt: Fmt; hint?: string; aggs: Agg[]; agg: Agg; field?: string; weight?: string; num?: string; den?: string; mult?: number; distinct?: string };
export type View = { rows: string[]; col: string | null; vals: string[]; filters: Record<string, string[]>; show?: string; sort?: string };
export type Facts = { key: string; label: string; grain: string; notes: string[]; dims: Dim[]; nums: string[]; measures: Measure[]; rows: Array<Array<number | null>>; defaults: View; snapshot?: string };
export const DATASETS = [
  { key: "plans", label: "Individual & small-group plans", hint: "Every filed plan, 2024–2027: design, premium, enrollment, rate change" },
  { key: "financials", label: "Carrier financials (all segments)", hint: "Members, premium, claims, loss ratio by carrier, state and segment, incl. large group" },
  { key: "employers", label: "Employer plans (Form 5500)", hint: "Large-group employers: carrier, funding, broker, premium per person, renewal month" },
  { key: "enrollment", label: "Enrollment by funding & group size", hint: "MA (CHIA, quarterly) and NH: fully insured vs self-funded, jumbo/large/mid/small, HMO/PPO" },
  { key: "selffunded", label: "Self-funded lives", hint: "ASO lives and fees carriers report, by state" },
  { key: "rates", label: "Large-group rate requests", hint: "Requested vs approved large-group rates where the regulator publishes them" },
  { key: "gic", label: "Mass. GIC plans", hint: "Public-employer large-group benchmark: premiums, increases, enrollment" },
  { key: "marketed", label: "Marketed products", hint: "How each product is sold, from carriers' websites: network model, funding, vendors" },
  { key: "serff", label: "SERFF filings", hint: "State filings added to the site: status, new products, rate change" },
] as const;
export type DatasetKey = (typeof DATASETS)[number]["key"];

type Comp = { id: string; name: string; aliases: string[]; issuerPattern: string | null };
const tidy = (s: string) => s.replace(/,?\s+(Inc\.?|LLC|Corp\.?|Corporation|Company|Co\.?)$/i, "").replace(/\s+/g, " ").trim();
const title = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Of|And|The|For|In)\b/g, (m) => m.toLowerCase()) : s);
function resolver(comps: Comp[]) {
  const res = comps.flatMap((c) => { try { return [{ name: c.name, re: new RegExp(issuerPatternFor(c), "i") }]; } catch { return []; } });
  const cache = new Map<string, string | null>();
  const hit = (s: string) => { let v = cache.get(s); if (v === undefined) { v = res.find((r) => r.re.test(s))?.name ?? null; cache.set(s, v); } return v; };
  return (...names: Array<string | null | undefined>) => { for (const n of names) if (n && hit(n)) return hit(n)!; const n = names.find(Boolean); return n ? title(tidy(n)) : null; };
}
const seg = (m: string | null | undefined) => (!m ? null : /large/i.test(m) ? "Large group" : /small|shop/i.test(m) ? "Small group" : /indiv/i.test(m) ? "Individual" : m);
const SEG: Record<string, string> = { INDIVIDUAL: "Individual", SMALL_GROUP: "Small group", LARGE_GROUP: "Large group" };
const yn = (b: boolean | null | undefined) => (b == null ? null : b ? "Yes" : "No");
const MONTHS = ["01 Jan", "02 Feb", "03 Mar", "04 Apr", "05 May", "06 Jun", "07 Jul", "08 Aug", "09 Sep", "10 Oct", "11 Nov", "12 Dec"];
const sizeBand = (n: number | null | undefined) => (n == null ? null : n < 51 ? "1 · up to 50" : n <= 100 ? "2 · 51–100" : n <= 500 ? "3 · 101–500" : n <= 1000 ? "4 · 501–1,000" : n <= 5000 ? "5 · 1,001–5,000" : "6 · 5,000+");

/** Builds a Facts table from plain objects: dims are dictionary-encoded, nums kept as numbers. */
class Builder {
  dims: Array<Omit<Dim, "values"> & { map: Map<string, number>; values: string[] }> = [];
  nums: string[] = [];
  rows: Array<Array<number | null>> = [];
  constructor(dims: Array<Omit<Dim, "values">>, nums: string[]) { this.dims = dims.map((d) => ({ ...d, map: new Map(), values: [] })); this.nums = nums; }
  add(r: Record<string, string | number | boolean | null | undefined>) {
    const row: Array<number | null> = this.dims.map((d) => {
      const v = r[d.key];
      if (v == null || v === "") return null;
      const s = String(v);
      let i = d.map.get(s);
      if (i === undefined) { i = d.values.length; d.values.push(s); d.map.set(s, i); }
      return i;
    });
    for (const n of this.nums) { const v = r[n]; row.push(typeof v === "number" && Number.isFinite(v) ? v : typeof v === "boolean" ? (v ? 1 : 0) : null); }
    this.rows.push(row);
  }
  done(meta: Omit<Facts, "dims" | "nums" | "rows">): Facts {
    // Sort each dimension's values (numbers numerically) and remap row indices, so pickers and pivots come out ordered.
    const dims: Dim[] = this.dims.map((d, di) => {
      const numeric = d.values.length > 0 && d.values.every((v) => /^-?\d+(\.\d+)?$/.test(v));
      const order = d.values.map((v, i) => ({ v, i })).sort((a, b) => (numeric ? Number(a.v) - Number(b.v) : a.v.localeCompare(b.v)));
      const remap = new Map(order.map((o, j) => [o.i, j]));
      for (const r of this.rows) if (r[di] != null) r[di] = remap.get(r[di]!)!;
      return { key: d.key, label: d.label, group: d.group, hint: d.hint, values: order.map((o) => o.v), numeric };
    });
    return { ...meta, dims, nums: this.nums, rows: this.rows };
  }
}
const M = (key: string, label: string, group: string, fmt: Fmt, o: Partial<Measure>): Measure => ({ key, label, group, fmt, aggs: o.aggs ?? (o.num ? ["ratio"] : o.distinct ? ["distinct"] : ["sum", "avg", "min", "max", "median"]), agg: o.agg ?? (o.num ? "ratio" : o.distinct ? "distinct" : "sum"), ...o });
const COUNT = (label: string) => M("_count", label, "Counts", "int", { aggs: ["count"], agg: "count" });

// How each carrier markets its products, from the monthly website read: carrier-wide flags.
async function marketingReads(): Promise<Array<{ site: string; m: Marketing }>> {
  const rows = await db.rateFile.findMany({ where: { id: { startsWith: "cache:marketing:" } }, select: { id: true, stats: true } });
  return rows.flatMap((r) => { const m = ((r.stats ?? {}) as { m?: Marketing }).m; return m?.products?.length ? [{ site: r.id.slice("cache:marketing:".length), m }] : []; });
}
async function carrierFlags(comps: Comp[]) {
  const reads = new Map((await marketingReads()).map((r) => [r.site, r.m]));
  const out = new Map<string, Record<string, string>>();
  for (const c of comps) {
    const m = reads.get(siteFor(c.name)?.key ?? "");
    if (m) out.set(c.name, Object.fromEntries(ARCHETYPES.map((a) => [`mk_${a.key}`, m.products.some((p) => a.test(p)) ? "Yes" : "No"])));
  }
  return out;
}
const MK_DIMS = ARCHETYPES.map((a) => ({ key: `mk_${a.key}`, label: `Carrier markets ${a.label.toLowerCase()}`, group: "How the carrier markets", hint: "From the carrier's own website; carrier-wide, not this plan" }));

// ── Datasets ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function plans(comps: Comp[]): Promise<Facts> {
  const who = resolver(comps);
  const flags = await carrierFlags(comps);
  const [rp, qhp] = await Promise.all([
    db.ratePlan.findMany({ where: { state: { in: NE } }, select: { planYear: true, state: true, company: true, market: true, productId: true, productName: true, planId: true, planName: true, metal: true, planType: true, onExchange: true, category: true, rateChange: true, enrollment: true, ratePmpm: true } }),
    db.qhpPlan.findMany({ where: { state: { in: NE } }, select: { year: true, state: true, issuerName: true, market: true, planId: true, productId: true, name: true, metal: true, planType: true, networkName: true, statewide: true, counties: true, isNew: true, standardized: true, hsa: true, tiered: true, referral: true, outOfNetwork: true, av: true, dedInd: true, moopInd: true, coinsurance: true, prem40: true } }),
  ]);
  type P = Record<string, string | number | boolean | null>;
  const m = new Map<string, P>();
  for (const r of rp) {
    const k = `${r.planYear}:${r.planId}`;
    const prev = m.get(k);
    if (prev && ((prev.members as number) ?? -1) >= (r.enrollment ?? -1)) continue; // refilings: keep the one with enrollment
    m.set(k, { year: r.planYear, state: r.state, carrier: who(r.company), entity: tidy(r.company), segment: seg(r.market), product: r.productName, plan: r.planName, metal: r.metal, ntype: r.planType, status: r.category, onx: yn(r.onExchange), members: r.enrollment, pmpm: r.ratePmpm, rate: r.rateChange, isNew: r.category === "New" ? 1 : 0, term: r.category === "Terminated" ? 1 : 0 });
  }
  for (const q of qhp) {
    const k = `${q.year}:${q.planId}`;
    const b = m.get(k) ?? { year: q.year, state: q.state, carrier: who(q.issuerName), entity: tidy(q.issuerName ?? ""), segment: seg(q.market), product: null, plan: q.name, metal: q.metal, ntype: q.planType, status: q.isNew ? "New" : null, onx: "Yes", isNew: q.isNew ? 1 : 0, term: 0 };
    m.set(k, { ...b, product: b.product ?? q.productId, metal: b.metal ?? q.metal, ntype: b.ntype ?? q.planType, nname: q.networkName, statewide: yn(q.statewide), hsa: yn(q.hsa), tiered: yn(q.tiered), referral: yn(q.referral), oon: yn(q.outOfNetwork), std: yn(q.standardized), av: q.av, ded: q.dedInd, moop: q.moopInd, coins: q.coinsurance, prem40: q.prem40, counties: q.counties });
  }
  const B = new Builder([
    { key: "year", label: "Plan year", group: "Plan" }, { key: "state", label: "State", group: "Plan" }, { key: "carrier", label: "Carrier", group: "Plan" }, { key: "entity", label: "Filing entity", group: "Plan" },
    { key: "segment", label: "Segment", group: "Plan" }, { key: "product", label: "Product", group: "Plan" }, { key: "plan", label: "Plan", group: "Plan" }, { key: "status", label: "Filing status", group: "Plan", hint: "New, renewing or terminated in the rate filing" }, { key: "onx", label: "On exchange", group: "Plan" },
    { key: "metal", label: "Metal", group: "Design" }, { key: "ntype", label: "Network type", group: "Design" }, { key: "nname", label: "Network name", group: "Design" }, { key: "statewide", label: "Statewide", group: "Design" },
    { key: "hsa", label: "HSA-eligible", group: "Design" }, { key: "tiered", label: "Tiered network", group: "Design" }, { key: "referral", label: "Referral needed", group: "Design" }, { key: "oon", label: "Out-of-network benefit", group: "Design" }, { key: "std", label: "Standardized design", group: "Design" },
    ...MK_DIMS,
  ], ["members", "prem40", "pmpm", "rate", "ded", "moop", "av", "coins", "counties", "isNew", "term"]);
  for (const p of m.values()) B.add({ ...p, ...(flags.get(String(p.carrier)) ?? {}) });
  return B.done({
    key: "plans", label: "Individual & small-group plans", grain: "One row per plan per year",
    notes: ["CMS rate-review filings (enrollment, rate change, status) joined to exchange plan files (design, premium). Carriers don't file large-group plans: for large group use Carrier financials, Employer plans or Enrollment.", "2027 premiums and design come from the exchange files where published; members and rate change come from the 2027 rate filings."],
    measures: [
      COUNT("Plans"), M("_products", "Products", "Counts", "int", { distinct: "product" }), M("_carriers", "Carriers", "Counts", "int", { distinct: "carrier" }),
      M("isNew", "New plans", "Counts", "int", { field: "isNew", aggs: ["sum"] }), M("term", "Terminated plans", "Counts", "int", { field: "term", aggs: ["sum"] }),
      M("members", "Members", "Members", "int", { field: "members", hint: "Enrollment at the time of the rate filing" }),
      M("prem40", "Premium, age 40", "Price", "usd", { field: "prem40", weight: "members", aggs: ["avg", "wavg", "min", "max", "median"], agg: "avg", hint: "Monthly, median across rating areas" }),
      M("pmpm", "Filed premium PMPM", "Price", "usd", { field: "pmpm", weight: "members", aggs: ["wavg", "avg", "min", "max", "median"], agg: "wavg" }),
      M("rate", "Filed rate change", "Price", "pct", { field: "rate", weight: "members", aggs: ["wavg", "avg", "min", "max", "median"], agg: "wavg" }),
      M("ded", "Deductible", "Design", "usd0", { field: "ded", weight: "members", aggs: ["avg", "median", "min", "max", "wavg"], agg: "median" }),
      M("moop", "Out-of-pocket max", "Design", "usd0", { field: "moop", aggs: ["avg", "median", "min", "max"], agg: "median" }),
      M("av", "Actuarial value", "Design", "pct", { field: "av", aggs: ["avg", "median", "min", "max"], agg: "avg" }),
      M("coins", "Coinsurance", "Design", "pct", { field: "coins", aggs: ["avg", "median", "min", "max"], agg: "median" }),
      M("counties", "Counties served", "Design", "num", { field: "counties", aggs: ["avg", "median", "min", "max"], agg: "avg" }),
    ],
    defaults: { rows: ["carrier"], col: "year", vals: ["_count:count", "members:sum", "prem40:avg"], filters: { state: ["MA"], segment: ["Individual"] } },
  });
}

async function financials(comps: Comp[]): Promise<Facts> {
  const who = resolver(comps);
  const [mf, me] = await Promise.all([
    db.marketFinancial.findMany({ where: { state: { in: NE } }, select: { year: true, state: true, company: true, groupName: true, segment: true, premium: true, claims: true, coveredLives: true, memberMonths: true, brokerFees: true } }),
    db.stateFinancial.findMany({ where: { state: { in: NE }, isTotal: false }, select: { year: true, state: true, company: true, segment: true, premium: true, claims: true, coveredLives: true, memberMonths: true, adminExpense: true, source: true } }),
  ]);
  const B = new Builder([{ key: "year", label: "Year", group: "Filing" }, { key: "state", label: "State", group: "Filing" }, { key: "segment", label: "Segment", group: "Filing" }, { key: "carrier", label: "Carrier", group: "Filing" }, { key: "entity", label: "Filing entity", group: "Filing" }, { key: "source", label: "Source", group: "Filing" }],
    ["lives", "mm", "premium", "claims", "broker"]);
  const seen = new Set<string>();
  for (const r of mf) { seen.add(`${r.year}|${r.state}|${r.segment}`); B.add({ year: r.year, state: r.state, segment: SEG[r.segment], carrier: who(r.company, r.groupName), entity: tidy(r.company), source: "CMS loss-ratio filings", lives: r.coveredLives, mm: r.memberMonths, premium: r.premium, claims: r.claims, broker: r.brokerFees }); }
  // State filings add years the federal data doesn't have yet (Maine's large-group report runs a year ahead).
  for (const r of me) if (!seen.has(`${r.year}|${r.state}|${r.segment}`)) B.add({ year: r.year, state: r.state, segment: SEG[r.segment], carrier: who(r.company), entity: tidy(r.company), source: "State insurance department", lives: r.coveredLives, mm: r.memberMonths, premium: r.premium, claims: r.claims });
  return B.done({
    key: "financials", label: "Carrier financials (all segments)", grain: "One row per filing entity, state, segment and year",
    notes: ["Fully insured business from CMS medical loss-ratio filings (through 2024), plus Maine's state large-group report for later years. Self-funded lives are in the Self-funded and Enrollment datasets.", "For market share, put Members on values and show it as “% of column total” with Year on columns."],
    measures: [
      M("lives", "Members", "Size", "int", { field: "lives", hint: "Covered lives at year end" }), M("mm", "Member months", "Size", "int", { field: "mm" }), M("_carriers", "Carriers", "Size", "int", { distinct: "carrier" }),
      M("premium", "Premium", "Dollars", "usd0", { field: "premium" }), M("claims", "Claims", "Dollars", "usd0", { field: "claims" }), M("broker", "Broker fees", "Dollars", "usd0", { field: "broker" }),
      M("pmpm", "Premium PMPM", "Per member", "usd", { num: "premium", den: "mm" }), M("cpmpm", "Claims PMPM", "Per member", "usd", { num: "claims", den: "mm" }),
      M("lr", "Loss ratio", "Ratios", "pct", { num: "claims", den: "premium", hint: "Claims ÷ premium" }), M("brk", "Broker fees % of premium", "Ratios", "pct", { num: "broker", den: "premium" }),
    ],
    defaults: { rows: ["carrier"], col: "year", vals: ["lives:sum", "pmpm:ratio", "lr:ratio"], filters: { state: ["MA"], segment: ["Large group"] } },
  });
}

async function employers(comps: Comp[]): Promise<Facts> {
  const who = resolver(comps);
  const plansRaw = await db.$queryRaw<Array<{ id: string; ein: string; planNum: string; sponsor: string; city: string | null; state: string; naics: string | null; participants: number | null; py: number; funding: string }>>`
    SELECT DISTINCT ON (ein, "planNum", py) id, ein, "planNum", sponsor, city, state, naics, participants, py, funding FROM (
      -- A plan year far from the filing year is a data-entry error (a plan's founding date): use the filing year then.
      SELECT *, CASE WHEN abs(date_part('year', "planYearBegin") - "formYear") <= 1 THEN date_part('year', "planYearBegin")::int ELSE "formYear" END AS py FROM "EmployerPlan" WHERE state = ANY(${NE})
    ) x ORDER BY ein, "planNum", py, "receivedAt" DESC NULLS LAST`;
  const ids = plansRaw.map((p) => p.id);
  const [contracts, admins] = await Promise.all([
    db.employerContract.findMany({ where: { planId: { in: ids } }, select: { planId: true, kind: true, carrier: true, personsCovered: true, premium: true, claims: true, brokerComm: true, brokerFees: true, policyFrom: true, hmo: true, ppo: true, brokers: true } }),
    db.employerProvider.findMany({ where: { planId: { in: ids }, role: "administrator" }, select: { planId: true, name: true, carrier: true } }),
  ]);
  const byPlan = new Map<string, typeof contracts>();
  for (const c of contracts) (byPlan.get(c.planId) ?? byPlan.set(c.planId, []).get(c.planId)!).push(c);
  const adminOf = new Map(admins.map((a) => [a.planId, a] as const));
  const B = new Builder([
    { key: "year", label: "Plan year", group: "Employer" }, { key: "state", label: "State", group: "Employer" }, { key: "employer", label: "Employer", group: "Employer" }, { key: "city", label: "City", group: "Employer" },
    { key: "industry", label: "Industry", group: "Employer" }, { key: "size", label: "Size (participants)", group: "Employer" }, { key: "funding", label: "Funding", group: "Employer", hint: "Insured: a health insurance contract is filed. Self-funded: benefits paid from employer assets or a trust." },
    { key: "carrier", label: "Carrier / administrator", group: "Coverage" }, { key: "asFiled", label: "Carrier as filed", group: "Coverage" }, { key: "network", label: "HMO / PPO", group: "Coverage" }, { key: "stoploss", label: "Stop-loss carrier", group: "Coverage" },
    { key: "broker", label: "Broker", group: "Coverage", hint: "Largest-paid broker on the contract" }, { key: "renewal", label: "Renewal month", group: "Coverage", hint: "Policy start month" },
  ], ["persons", "premium", "claims", "comm", "participants", "paired_prem", "paired_claims"]);
  for (const p of plansRaw) {
    const cs = byPlan.get(p.id) ?? [], health = cs.filter((c) => c.kind === "health"), stop = cs.find((c) => c.kind === "stop_loss");
    const base = { year: Number(p.py), state: p.state, employer: title(p.sponsor), city: p.city ? title(p.city) : null, industry: sectorOf(p.naics), size: sizeBand(p.participants), funding: p.funding === "self-funded" ? "Self-funded" : p.funding === "mixed" ? "Mixed" : "Insured", stoploss: stop ? who(stop.carrier) : null };
    if (!health.length) {
      const a = adminOf.get(p.id);
      B.add({ ...base, carrier: a ? who(a.carrier, a.name) : "(administrator not filed)", asFiled: a?.name ?? null, persons: p.participants, participants: p.participants });
      continue;
    }
    health.forEach((c, i) => {
      const br = ((c.brokers as Array<{ name: string; commission?: number; fees?: number }> | null) ?? []).sort((a, b) => (b.commission ?? 0) + (b.fees ?? 0) - (a.commission ?? 0) - (a.fees ?? 0))[0];
      const comm = c.brokerComm != null || c.brokerFees != null ? (c.brokerComm ?? 0) + (c.brokerFees ?? 0) : null;
      B.add({ ...base, carrier: who(c.carrier), asFiled: title(c.carrier), network: c.hmo && c.ppo ? "HMO and PPO" : c.hmo ? "HMO" : c.ppo ? "PPO" : null, broker: br?.name ? title(br.name) : null, renewal: c.policyFrom ? MONTHS[c.policyFrom.getUTCMonth()] : null,
        persons: c.personsCovered, premium: c.premium, claims: c.claims, comm, participants: i === 0 ? p.participants : null,
        paired_prem: c.premium != null && c.claims != null ? c.premium : null, paired_claims: c.premium != null && c.claims != null ? c.claims : null });
    });
  }
  return B.done({
    key: "employers", label: "Employer plans (Form 5500)", grain: "One row per health insurance contract (or per self-funded plan)",
    notes: ["DOL Form 5500 filings of New England employers' health plans: mostly plans with 100+ participants, so this is the large-group book. Filings arrive 7–10 months after a plan year ends.", "Premium per person and loss ratio are computed across contracts that report both figures."],
    measures: [
      M("_employers", "Employers", "Counts", "int", { distinct: "employer" }), COUNT("Contracts"), M("persons", "Covered persons", "Size", "int", { field: "persons", hint: "Persons covered by the contract at year end" }),
      M("participants", "Participants", "Size", "int", { field: "participants", hint: "Plan participants (employees and retirees), counted once per plan" }),
      M("premium", "Premium", "Dollars", "usd0", { field: "premium" }), M("claims", "Claims paid", "Dollars", "usd0", { field: "claims" }), M("comm", "Broker pay", "Dollars", "usd0", { field: "comm", hint: "Commissions plus fees" }),
      M("ppm", "Premium per person per month", "Ratios", "usd", { num: "premium", den: "persons", mult: 1 / 12 }), M("lr", "Loss ratio", "Ratios", "pct", { num: "paired_claims", den: "paired_prem", hint: "Claims ÷ premium, contracts reporting both" }), M("brk", "Broker pay % of premium", "Ratios", "pct", { num: "comm", den: "premium" }),
    ],
    defaults: { rows: ["carrier"], col: "year", vals: ["_employers:distinct", "persons:sum", "ppm:ratio"], filters: { state: ["MA"] } },
  });
}

async function enrollment(comps: Comp[]): Promise<Facts> {
  const who = resolver(comps);
  const rows = await db.marketEnrollment.findMany({ where: { state: { in: NE } }, select: { source: true, state: true, asOf: true, payer: true, funding: true, segment: true, sector: true, productType: true, members: true, estimated: true } });
  const B = new Builder([
    { key: "asof", label: "As of", group: "Count" }, { key: "year", label: "Year", group: "Count" }, { key: "quarter", label: "Quarter", group: "Count" }, { key: "state", label: "State", group: "Count" },
    { key: "carrier", label: "Carrier", group: "Market" }, { key: "segment", label: "Segment", group: "Market" }, { key: "funding", label: "Funding", group: "Market" }, { key: "size", label: "Group size", group: "Market" }, { key: "ptype", label: "Product type", group: "Market" }, { key: "estimated", label: "Estimated", group: "Count", hint: "Derived from published shares rather than reported" },
  ], ["members"]);
  for (const r of rows) {
    const d = r.asOf;
    B.add({ asof: d.toISOString().slice(0, 7), year: d.getUTCFullYear(), quarter: `Q${Math.floor(d.getUTCMonth() / 3) + 1}`, state: r.state, carrier: who(r.payer), segment: SEG[r.segment], funding: r.funding === "SELF_INSURED" ? "Self-funded" : "Fully insured", size: r.sector, ptype: r.productType || null, estimated: yn(r.estimated), members: r.members });
  }
  return B.done({
    key: "enrollment", label: "Enrollment by funding & group size", grain: "One row per carrier, funding, group size and product type at each count date",
    notes: ["Massachusetts from CHIA's quarterly enrollment report; New Hampshire from the insurance department's annual report. These are point-in-time counts: keep “As of” (or Year with one Quarter) on rows, columns or filters, or the counts add up across dates.", "Self-funded members here are carriers' ASO books in Massachusetts, by the state the employer is in."],
    measures: [M("members", "Members", "Members", "int", { field: "members" }), M("_carriers", "Carriers", "Members", "int", { distinct: "carrier" })],
    defaults: { rows: ["carrier"], col: "year", vals: ["members:sum"], filters: { state: ["MA"], segment: ["Large group"], quarter: ["Q3"] } },
    snapshot: "asof",
  });
}

async function selffunded(comps: Comp[]): Promise<Facts> {
  const who = resolver(comps);
  const rows = await db.selfFundedLives.findMany({ where: { state: { in: NE } } });
  const B = new Builder([{ key: "year", label: "Year", group: "Filing" }, { key: "state", label: "State", group: "Filing" }, { key: "carrier", label: "Carrier", group: "Filing" }, { key: "entity", label: "Filing entity", group: "Filing" }, { key: "basis", label: "Basis", group: "Filing", hint: "Reported in the state; allocated from a home-state total; or disclosed nationally" }], ["lives", "mm", "fees"]);
  for (const r of rows) B.add({ year: r.year, state: r.state, carrier: who(r.company, r.groupName), entity: tidy(r.company), basis: r.basis === "reported" ? "Reported" : r.basis === "allocated" ? "Allocated (estimate)" : "Disclosed", lives: r.lives, mm: r.memberMonths, fees: r.fees });
  return B.done({
    key: "selffunded", label: "Self-funded lives", grain: "One row per filing entity, state and year",
    notes: ["Lives in self-funded (ASO) plans that carriers administer, from CMS loss-ratio filings. “Allocated” rows spread a regional carrier's home-state total across the states it sells in."],
    measures: [M("lives", "Self-funded lives", "Size", "int", { field: "lives" }), M("fees", "ASO fees", "Dollars", "usd0", { field: "fees" }), M("fpm", "Fees per member per month", "Ratios", "usd", { num: "fees", den: "mm" })],
    defaults: { rows: ["carrier"], col: "year", vals: ["lives:sum"], filters: { state: ["MA"] } },
  });
}

async function rates(comps: Comp[]): Promise<Facts> {
  const who = resolver(comps);
  const rows = await db.groupRateAction.findMany({ where: { isTotal: false } });
  const B = new Builder([{ key: "year", label: "Plan year", group: "Filing" }, { key: "state", label: "State", group: "Filing" }, { key: "segment", label: "Segment", group: "Filing" }, { key: "carrier", label: "Carrier", group: "Filing" }, { key: "source", label: "Regulator", group: "Filing" }], ["members", "requested", "approved", "cut"]);
  for (const r of rows) B.add({ year: r.planYear, state: r.state, segment: SEG[r.segment], carrier: who(r.carrier), source: r.source === "ri_ohic" ? "RI OHIC" : r.source, members: r.members, requested: r.requested, approved: r.approved, cut: r.requested != null && r.approved != null ? r.approved - r.requested : null });
  return B.done({
    key: "rates", label: "Large-group rate requests", grain: "One row per carrier, state and plan year",
    notes: ["Large-group rate requests and the regulator's decision, where the state publishes them (Rhode Island's OHIC today). Massachusetts and Connecticut don't publish large-group rate decisions by carrier."],
    measures: [M("members", "Members", "Size", "int", { field: "members" }), M("requested", "Requested rate", "Rates", "pct", { field: "requested", weight: "members", aggs: ["wavg", "avg", "min", "max"], agg: "wavg" }), M("approved", "Approved rate", "Rates", "pct", { field: "approved", weight: "members", aggs: ["wavg", "avg", "min", "max"], agg: "wavg" }), M("cut", "Regulator cut", "Rates", "pct", { field: "cut", weight: "members", aggs: ["wavg", "avg", "min", "max"], agg: "wavg", hint: "Approved minus requested" })],
    defaults: { rows: ["carrier"], col: "year", vals: ["requested:wavg", "approved:wavg"], filters: {} },
  });
}

async function gic(comps: Comp[]): Promise<Facts> {
  const who = resolver(comps);
  const B = new Builder([{ key: "year", label: "Fiscal year", group: "Plan" }, { key: "carrier", label: "Carrier", group: "Plan" }, { key: "product", label: "Product", group: "Plan" }, { key: "plan", label: "Plan", group: "Plan" }, { key: "network", label: "Network", group: "Plan" }, { key: "type", label: "Plan type", group: "Plan" }],
    ["subs", "indPrem", "famPrem", "indChg", "famChg", "indSubs", "famSubs"]);
  for (const y of GIC_YEARS) for (const p of y.plans) {
    const i = p.premium.individual, f = p.premium.family;
    B.add({ year: y.fiscalYear, carrier: who(p.carrier), product: p.product, plan: p.name, network: p.network, type: p.type, subs: (i.enrollment ?? 0) + (f.enrollment ?? 0) || null, indPrem: i.current, famPrem: f.current, indChg: i.change, famChg: f.change, indSubs: i.enrollment, famSubs: f.enrollment });
  }
  return B.done({
    key: "gic", label: "Mass. GIC plans", grain: "One row per plan per fiscal year",
    notes: ["The Group Insurance Commission covers Massachusetts state and many municipal employees, mostly self-insured with the carrier as administrator. Premiums are the full monthly cost per subscriber (employer plus employee share), so they are a public large-group price benchmark."],
    measures: [COUNT("Plans"), M("subs", "Subscribers", "Enrollment", "int", { field: "subs" }), M("indPrem", "Individual premium (monthly)", "Premium", "usd", { field: "indPrem", weight: "indSubs", aggs: ["avg", "wavg", "min", "max"], agg: "avg" }), M("famPrem", "Family premium (monthly)", "Premium", "usd", { field: "famPrem", weight: "famSubs", aggs: ["avg", "wavg", "min", "max"], agg: "avg" }), M("indChg", "Individual increase", "Premium", "pct", { field: "indChg", weight: "indSubs", aggs: ["avg", "wavg", "min", "max"], agg: "avg" }), M("famChg", "Family increase", "Premium", "pct", { field: "famChg", weight: "famSubs", aggs: ["avg", "wavg", "min", "max"], agg: "avg" })],
    defaults: { rows: ["carrier", "plan"], col: "year", vals: ["indPrem:avg", "subs:sum"], filters: {} },
  });
}

async function marketed(comps: Comp[]): Promise<Facts> {
  const who = resolver(comps);
  const site2carrier = new Map(comps.map((c) => [siteFor(c.name)?.key, c.name] as const).filter(([k]) => k) as Array<[string, string]>);
  const B = new Builder([
    { key: "carrier", label: "Carrier", group: "Product" }, { key: "product", label: "Product", group: "Product" }, { key: "family", label: "Product family", group: "Product" }, { key: "segment", label: "Segment", group: "Product", hint: "A product sold in several segments appears once per segment" },
    { key: "state", label: "State", group: "Product" }, { key: "buyer", label: "Aimed at", group: "Product" }, { key: "ptype", label: "Plan type", group: "Network" }, { key: "network", label: "Network model", group: "Network" }, { key: "pcp", label: "PCP required", group: "Network" },
    { key: "virtual", label: "Virtual-first", group: "Design" }, ...ARCHETYPES.filter((a) => !["virtual", "limited", "system", "tiered"].includes(a.key)).map((a) => ({ key: `a_${a.key}`, label: a.label, group: "Design" })),
    { key: "funding", label: "Funding", group: "Design", hint: "A product with several funding options appears once per option" }, { key: "partner", label: "Vendor or partner", group: "Marketing", hint: "A product with several partners appears once per partner" }, { key: "role", label: "Partner role", group: "Marketing" },
  ], []);
  for (const { site, m } of await marketingReads()) {
    const carrier = site2carrier.get(site) ?? who(m.label);
    for (const p of m.products) {
      const segs = p.segments.length ? p.segments : [null], funds = p.funding.length ? p.funding : [null], parts = p.partners.length ? p.partners : [null], sts = p.states.length ? p.states : [null];
      const base = { carrier, product: `${p.name}`, family: p.family ?? null, buyer: p.targetBuyer ?? null, ptype: p.planType ?? null, network: p.network, pcp: yn(p.pcpRequired ?? null), virtual: yn(p.virtualFirst),
        ...Object.fromEntries(ARCHETYPES.filter((a) => !["virtual", "limited", "system", "tiered"].includes(a.key)).map((a) => [`a_${a.key}`, yn(a.test(p))])) };
      for (const s of segs) for (const st of sts) for (const f of funds) for (const pt of parts)
        B.add({ ...base, segment: s ? s.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : null, state: st, funding: f ? f.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : null, partner: pt?.name ?? null, role: pt?.role ?? null });
    }
  }
  return B.done({
    key: "marketed", label: "Marketed products", grain: "One row per product × segment × state × funding option × partner",
    notes: ["Read by AI from carriers' own websites and brochures, refreshed monthly; what each carrier markets now, with no year. Count with “Products” (distinct), not Rows, because a product appears once per segment, state, funding option and partner."],
    measures: [M("_products", "Products", "Counts", "int", { distinct: "product" }), M("_carriers", "Carriers", "Counts", "int", { distinct: "carrier" }), M("_partners", "Vendors and partners", "Counts", "int", { distinct: "partner" }), COUNT("Rows")],
    defaults: { rows: ["carrier"], col: "network", vals: ["_products:distinct"], filters: {} },
  });
}

async function serff(comps: Comp[]): Promise<Facts> {
  const who = resolver(comps);
  const rows = await db.serffFiling.findMany({ include: { _count: { select: { crosswalk: true } } } });
  const B = new Builder([{ key: "year", label: "Plan year", group: "Filing" }, { key: "state", label: "State", group: "Filing" }, { key: "carrier", label: "Carrier", group: "Filing" }, { key: "entity", label: "Filing company", group: "Filing" }, { key: "market", label: "Market", group: "Filing" }, { key: "kind", label: "Kind", group: "Filing" }, { key: "toi", label: "Type of insurance", group: "Filing" }, { key: "status", label: "Status", group: "Filing" }, { key: "newProduct", label: "New product or plan", group: "Filing" }, { key: "objections", label: "Regulator objections", group: "Filing" }, { key: "product", label: "Product", group: "Filing" }],
    ["rate", "plans", "newPlans"]);
  for (const f of rows) {
    const d = (f.detail ?? {}) as { plans?: unknown[]; newPlanIds?: unknown[]; objections?: string | null };
    B.add({ year: f.planYear, state: f.state, carrier: who(f.company), entity: f.company, market: seg(f.market), kind: /binder/i.test(f.filingType ?? "") ? "Plan binder" : f.filingType, toi: f.toi, status: f.disposition?.split(/\s+[-–(]|;/)[0] ?? null, newProduct: yn(f.newProduct), objections: yn(!!d.objections), product: f.productName, rate: f.rateChange, plans: d.plans?.length ?? null, newPlans: d.newPlanIds?.length ?? null });
  }
  return B.done({
    key: "serff", label: "SERFF filings", grain: "One row per filing", notes: ["Filings uploaded on the State filings page. Coverage depends on what has been uploaded."],
    measures: [COUNT("Filings"), M("plans", "Plans in filing", "Plans", "int", { field: "plans" }), M("newPlans", "New plans", "Plans", "int", { field: "newPlans" }), M("rate", "Rate change", "Rates", "pct", { field: "rate", aggs: ["avg", "min", "max"], agg: "avg" })],
    defaults: { rows: ["carrier"], col: "market", vals: ["_count:count"], filters: {} },
  });
}

const BUILDERS: Record<DatasetKey, (c: Comp[]) => Promise<Facts>> = { plans, financials, employers, enrollment, selffunded, rates, gic, marketed, serff };
const cache = new Map<string, { at: number; f: Facts }>();
export async function facts(key: DatasetKey, workspaceId: string, comps: Comp[]): Promise<Facts> {
  const k = `${workspaceId}:${key}`, hit = cache.get(k);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.f;
  const f = await BUILDERS[key](comps);
  cache.set(k, { at: Date.now(), f });
  return f;
}
