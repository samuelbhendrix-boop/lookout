import { db } from "../db";
import { issuerPatternFor } from "./queries";

/**
 * Product intelligence for one carrier, built from two public sources:
 *  - Exchange plan designs (QhpPlan, CMS QHP PUFs): every on-exchange plan's deductible, out-of-pocket max,
 *    coinsurance, network, service area, covered benefits and age-rated premiums.
 *  - Rate filings (RatePlan, CMS URRT): every ACA individual/small-group plan incl. off-exchange, with enrollment,
 *    rate change and premium PMPM.
 * Comparisons are always within the same state, market, plan year and metal tier.
 */

export type Plan = Awaited<ReturnType<typeof loadPlans>>[number] & { enrollment: number | null; enrollmentYear: number | null; rateChange: number | null; ratePmpm: number | null; category: string | null };
type Filter = { state?: string; year?: number };

const METALS = ["Platinum", "Gold", "Silver", "Expanded Bronze", "Bronze", "Catastrophic"];
export const metalOrder = (m: string | null) => { const i = METALS.indexOf(m ?? ""); return i < 0 ? 99 : i; };
const median = (xs: number[]) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!s.length) return null; return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
const metalKey = (m: string | null) => (m === "Expanded Bronze" ? "Bronze" : m ?? "—");

/** Benefits that differ between plans and matter when selling. Everything else is effectively universal (EHB). */
export const DIFFERENTIATORS: Array<{ label: string; match: RegExp }> = [
  { label: "Adult dental", match: /^(Routine Dental Services \(Adult\)|Basic Dental Care - Adult)$/ },
  { label: "Adult vision exam", match: /^Routine Eye Exam \(Adult\)$/ },
  { label: "Adult eyeglasses", match: /^Eye Glasses for Adults$/ },
  { label: "Hearing aids", match: /^Hearing Aids$/ },
  { label: "Acupuncture", match: /^Acupuncture$/ },
  { label: "Chiropractic", match: /^Chiropractic Care$/ },
  { label: "Bariatric surgery", match: /^Bariatric Surgery$/ },
  { label: "Infertility treatment", match: /^Infertility Treatment$/ },
  { label: "Weight loss programs", match: /^Weight Loss Programs$/ },
  { label: "Routine foot care", match: /^Routine Foot Care$/ },
  { label: "Private-duty nursing", match: /^Private-Duty Nursing$/ },
  { label: "Long-term/custodial care", match: /^Long-Term\/Custodial Nursing Home Care$/ },
  { label: "Cosmetic surgery", match: /^Cosmetic Surgery$/ },
  { label: "Non-emergency care abroad", match: /^Non-Emergency Care When Traveling Outside the U\.S\.$/ },
  { label: "Nutritional counseling", match: /^Nutritional Counseling$/ },
  { label: "Abortion (non-Hyde)", match: /^Abortion for Which Public Funding is Prohibited$/ },
];
const has = (p: { covered: string[] }, d: { match: RegExp }) => p.covered.some((c) => d.match.test(c));

async function loadPlans(f: Filter) {
  return db.qhpPlan.findMany({
    where: { ...(f.state ? { state: f.state } : {}), ...(f.year ? { year: f.year } : {}) },
    orderBy: [{ state: "asc" }, { market: "asc" }, { metal: "asc" }, { prem40: "asc" }],
  });
}

/** Attach enrollment / rate change / PMPM from the same plan year's rate filing (latest filing version per plan). */
async function withFilings<T extends { planId: string; year: number }>(plans: T[]) {
  if (!plans.length) return [] as Array<T & { enrollment: number | null; enrollmentYear: number | null; rateChange: number | null; ratePmpm: number | null; category: string | null }>;
  const rows = await db.$queryRaw<Array<{ planId: string; planYear: number; enrollment: number | null; rateChange: number | null; ratePmpm: number | null; category: string }>>`
    SELECT DISTINCT ON ("planId", "planYear") "planId", "planYear", enrollment, "rateChange", "ratePmpm", category
    FROM "RatePlan" WHERE "planId" = ANY(${[...new Set(plans.map((p) => p.planId))]})
    ORDER BY "planId", "planYear", "effectiveDate" DESC`;
  const k = new Map(rows.map((r) => [`${r.planYear}:${r.planId}`, r]));
  // Before CMS publishes a year's rate filings, the prior year's filing (enrollment at the time of filing) is the
  // latest count for a continuing plan; rate change and category belong to their own year, so only enrollment carries.
  return plans.map((p) => {
    const r = k.get(`${p.year}:${p.planId}`), prev = r ? null : k.get(`${p.year - 1}:${p.planId}`);
    return { ...p, enrollment: r?.enrollment ?? prev?.enrollment ?? null, enrollmentYear: r ? p.year : prev ? p.year - 1 : null, rateChange: r?.rateChange ?? null, ratePmpm: r?.ratePmpm ?? null, category: r?.category ?? null };
  });
}

/** Latest Exchange plan year per state (federal files arrive months before the state-exchange ones). */
export async function qhpYears() {
  const rows = await db.qhpPlan.groupBy({ by: ["state", "year"], _count: true, orderBy: [{ state: "asc" }, { year: "asc" }] });
  const latest = new Map<string, number>();
  for (const r of rows) latest.set(r.state, Math.max(latest.get(r.state) ?? 0, r.year));
  return { rows, latest, years: [...new Set(rows.map((r) => r.year))].sort() };
}

/** Second-lowest-cost silver (the ACA subsidy benchmark) per rating area, individual market, age 40. */
function benchmarks(plans: Array<{ issuerId: string; issuerName: string | null; market: string; metal: string | null; areaPrem40: unknown; name: string }>) {
  const areas = new Map<string, Array<{ issuerId: string; issuer: string; price: number; name: string }>>();
  for (const p of plans) {
    if (p.market !== "Individual" || p.metal !== "Silver" || !p.areaPrem40) continue;
    for (const [area, price] of Object.entries(p.areaPrem40 as Record<string, number>)) {
      (areas.get(area) ?? areas.set(area, []).get(area)!).push({ issuerId: p.issuerId, issuer: p.issuerName ?? p.issuerId, price, name: p.name });
    }
  }
  return [...areas.entries()].map(([area, list]) => {
    const s = list.sort((a, b) => a.price - b.price);
    return { area, lowest: s[0], benchmark: s[1] ?? null, silverPlans: s.length };
  }).sort((a, b) => a.area.localeCompare(b.area, "en", { numeric: true }));
}

export const NE_STATES = ["MA", "CT", "RI", "NH", "VT", "ME"];

/** Plans renumbered between years keep their name, minus years and punctuation. */
export const planKey = (p: { name: string; metal: string | null }) => `${metalKey(p.metal)}|${p.name.toLowerCase().replace(/\b20\d\d\b/g, "").replace(/[^a-z0-9]+/g, "")}`;

export async function competitorProducts(c: { name: string; aliases: string[]; issuerPattern: string | null }, f: Filter = {}) {
  const re = new RegExp(issuerPatternFor(c), "i");
  const { latest } = await qhpYears();
  // Which states and years: the carrier's Exchange states, each at its latest year unless a year is asked for.
  const mineAll = await db.qhpPlan.findMany({ where: f.state ? { state: f.state } : {}, select: { state: true, year: true, issuerName: true, issuerId: true } });
  const issuerIds = new Set(mineAll.filter((p) => p.issuerName && re.test(p.issuerName)).map((p) => p.issuerId));
  const states = [...new Set(mineAll.filter((p) => issuerIds.has(p.issuerId)).map((p) => p.state))].sort();
  const yearFor = (st: string) => f.year ?? latest.get(st) ?? 0;

  const markets: Array<ReturnType<typeof marketView>> = [];
  for (const st of states) {
    const y = yearFor(st);
    const [cur, prev] = await Promise.all([loadPlans({ state: st, year: y }), loadPlans({ state: st, year: y - 1 })]);
    const curF = await withFilings(cur);
    for (const market of ["Individual", "SHOP"]) {
      const all = curF.filter((p) => p.market === market);
      if (!all.some((p) => issuerIds.has(p.issuerId))) continue;
      markets.push(marketView(st, y, market, all, prev.filter((p) => p.market === market), issuerIds));
    }
  }

  // Full product line-up from rate filings: includes off-exchange plans the Exchange files don't list.
  const pattern = issuerPatternFor(c);
  const lineupYear = await db.$queryRaw<Array<{ y: number | null }>>`SELECT MAX("planYear") y FROM "RatePlan" WHERE company ~* ${pattern} AND state = ANY(${f.state ? [f.state] : NE_STATES})`;
  const ly = lineupYear[0]?.y ?? null;
  const lineup = ly ? await db.$queryRaw<Array<{
    state: string; market: string; productId: string; productName: string; planType: string | null; plans: number; newPlans: number; terminated: number;
    onExchange: number; enrollment: number; rateChange: number | null; pmpm: number | null; metals: string[];
  }>>`
    WITH p AS (
      SELECT DISTINCT ON ("planId") * FROM "RatePlan"
      WHERE "planYear" = ${ly} AND company ~* ${pattern} AND state = ANY(${f.state ? [f.state] : NE_STATES})
      ORDER BY "planId", "effectiveDate" DESC)
    SELECT state, market, "productId", max("productName") "productName", max("planType") "planType",
      count(*) FILTER (WHERE category <> 'Terminated')::int plans, count(*) FILTER (WHERE category = 'New')::int "newPlans",
      count(*) FILTER (WHERE category = 'Terminated')::int terminated, count(*) FILTER (WHERE "onExchange" AND category <> 'Terminated')::int "onExchange",
      coalesce(sum(enrollment), 0)::int enrollment,
      (sum("rateChange" * enrollment) FILTER (WHERE category = 'Renewing' AND enrollment > 0) / nullif(sum(enrollment) FILTER (WHERE category = 'Renewing' AND enrollment > 0), 0))::float "rateChange",
      (sum("ratePmpm" * enrollment) FILTER (WHERE "ratePmpm" > 0 AND enrollment > 0) / nullif(sum(enrollment) FILTER (WHERE "ratePmpm" > 0 AND enrollment > 0), 0))::float pmpm,
      array_agg(DISTINCT metal) FILTER (WHERE metal IS NOT NULL AND category <> 'Terminated') metals
    FROM p GROUP BY state, market, "productId" ORDER BY state, market, enrollment DESC`
    : [];
  // Market totals for share of enrollment (same plan year, same filings basis).
  const totals = ly ? await db.$queryRaw<Array<{ state: string; market: string; enrollment: number }>>`
    WITH p AS (SELECT DISTINCT ON ("planId") state, market, enrollment FROM "RatePlan" WHERE "planYear" = ${ly} ORDER BY "planId", "effectiveDate" DESC)
    SELECT state, market, coalesce(sum(enrollment), 0)::int enrollment FROM p WHERE state = ANY(${[...new Set(lineup.map((l) => l.state))]}) GROUP BY 1, 2` : [];

  return { states, markets, lineup, lineupYear: ly, totals, latest: Object.fromEntries(latest) };
}

/** Everything for one state × market × year: the carrier's plans and how they sit against everyone else's. */
function marketView<P extends Plan>(state: string, year: number, market: string, all: P[], prev: Array<{ planId: string; issuerId: string; metal: string | null; dedInd: number | null; moopInd: number | null; prem40: number | null; networkName: string | null; planType: string | null; hsa: boolean; covered: string[]; name: string }>, mineIds: Set<string>) {
  const mine = all.filter((p) => mineIds.has(p.issuerId));
  const others = all.filter((p) => !mineIds.has(p.issuerId));
  const issuers = new Map<string, string>();
  for (const p of all) issuers.set(p.issuerId, p.issuerName ?? p.issuerId);

  // Price and design position by metal.
  const metals = [...new Set(all.map((p) => metalKey(p.metal)))].sort((a, b) => metalOrder(a) - metalOrder(b));
  const position = metals.map((m) => {
    const inM = all.filter((p) => metalKey(p.metal) === m);
    const mm = inM.filter((p) => mineIds.has(p.issuerId));
    const byIssuer = [...issuers.keys()].map((id) => ({ id, low: min(inM.filter((p) => p.issuerId === id && p.prem40).map((p) => p.prem40!)) })).filter((x) => x.low != null).sort((a, b) => a.low! - b.low!);
    const myLow = min(mm.filter((p) => p.prem40).map((p) => p.prem40!));
    return {
      metal: m, plans: mm.length, marketPlans: inM.length, issuers: byIssuer.length,
      lowest: myLow, marketLowest: byIssuer[0]?.low ?? null, lowestBy: byIssuer[0] ? issuers.get(byIssuer[0].id)! : null,
      median: median(mm.map((p) => p.prem40!).filter(Boolean)), marketMedian: median(inM.map((p) => p.prem40!).filter(Boolean)),
      rank: myLow != null ? byIssuer.findIndex((x) => mineIds.has(x.id)) + 1 : null,
      ded: median(mm.map((p) => p.dedInd!).filter((x) => x != null)), marketDed: median(inM.map((p) => p.dedInd!).filter((x) => x != null)),
      moop: median(mm.map((p) => p.moopInd!).filter((x) => x != null)), marketMoop: median(inM.map((p) => p.moopInd!).filter((x) => x != null)),
      baby: median(mm.map((p) => p.sbcBaby!).filter((x) => x != null)), marketBaby: median(inM.map((p) => p.sbcBaby!).filter((x) => x != null)),
      hsa: mm.filter((p) => p.hsa).length,
    };
  });

  const bench = market === "Individual" ? benchmarks(all) : [];
  const benchHeld = bench.filter((b) => b.benchmark && mineIds.has(b.benchmark.issuerId)).length;
  const lowestHeld = bench.filter((b) => mineIds.has(b.lowest.issuerId)).length;

  // Benefits: where this carrier differs from the rest of the market.
  const extras = DIFFERENTIATORS.map((d) => ({
    label: d.label,
    mine: mine.length ? mine.filter((p) => has(p, d)).length / mine.length : 0,
    others: others.length ? others.filter((p) => has(p, d)).length / others.length : 0,
    byIssuer: [...issuers.entries()].map(([id, name]) => { const ps = all.filter((p) => p.issuerId === id); return { name, share: ps.length ? ps.filter((p) => has(p, d)).length / ps.length : 0, mine: mineIds.has(id) }; }),
  })).filter((x) => x.mine > 0 || x.others > 0);

  // What changed since last year (same state, market). A plan continues if its HIOS id or its name survives —
  // carriers renumber plans between years, which would otherwise read as everything dropped and re-added.
  const pm = prev.filter((p) => mineIds.has(p.issuerId));
  const match = (p: { planId: string; name: string; metal: string | null }) => pm.find((q) => q.planId === p.planId) ?? pm.find((q) => planKey(q) === planKey(p));
  const continuing = mine.map((p) => ({ cur: p, was: match(p) })).filter((x): x is { cur: P; was: (typeof pm)[number] } => !!x.was);
  const matchedPrev = new Set(continuing.map((x) => x.was.planId));
  const premChanges = continuing.filter((x) => x.cur.prem40 && x.was.prem40).map((x) => x.cur.prem40! / x.was.prem40! - 1);
  const marketPrem = all.map((p) => ({ p, q: prev.find((q) => q.planId === p.planId) ?? prev.find((q) => q.issuerId === p.issuerId && planKey(q) === planKey(p)) }))
    .filter((x) => x.q?.prem40 && x.p.prem40).map((x) => x.p.prem40! / x.q!.prem40! - 1);
  const nets = (xs: Array<{ networkName: string | null }>) => new Set(xs.map((p) => p.networkName?.trim()).filter(Boolean) as string[]);
  const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");
  const nNow = nets(mine), nBefore = nets(pm);
  // Lowest premium per metal, this year vs last — robust to renumbering and plan churn.
  const lowBy = (xs: Array<{ metal: string | null; prem40: number | null }>, m: string) => min(xs.filter((p) => metalKey(p.metal) === m && p.prem40).map((p) => p.prem40!));
  const changes = prev.length ? {
    prevYear: year - 1,
    added: mine.filter((p) => !continuing.some((x) => x.cur.planId === p.planId)).map((p) => ({ name: p.name, metal: p.metal, prem40: p.prem40, dedInd: p.dedInd })),
    dropped: pm.filter((p) => !matchedPrev.has(p.planId)).map((p) => ({ name: p.name, metal: p.metal, prem40: p.prem40, dedInd: p.dedInd })),
    continuing: continuing.length,
    premiumChange: median(premChanges), marketPremiumChange: median(marketPrem),
    lowest: metals.map((m) => ({ metal: m, now: lowBy(mine, m), before: lowBy(pm, m), marketNow: lowBy(all, m), marketBefore: lowBy(prev, m) })).filter((x) => x.now != null || x.before != null),
    dedChanges: continuing.filter((x) => x.cur.dedInd != null && x.was.dedInd != null && x.cur.dedInd !== x.was.dedInd).map((x) => ({ name: x.cur.name, metal: x.cur.metal, from: x.was.dedInd!, to: x.cur.dedInd! })),
    moopChanges: continuing.filter((x) => x.cur.moopInd != null && x.was.moopInd != null && x.cur.moopInd !== x.was.moopInd).map((x) => ({ name: x.cur.name, metal: x.cur.metal, from: x.was.moopInd!, to: x.cur.moopInd! })),
    benefitChanges: DIFFERENTIATORS.map((d) => ({ label: d.label, before: pm.length ? pm.filter((p) => has(p, d)).length / pm.length : 0, now: mine.length ? mine.filter((p) => has(p, d)).length / mine.length : 0 })).filter((x) => Math.abs(x.now - x.before) >= 0.25),
    networksAdded: [...nNow].filter((n) => ![...nBefore].some((b) => same(b, n))), networksDropped: [...nBefore].filter((n) => ![...nNow].some((b) => same(b, n))),
    hsaBefore: pm.filter((p) => p.hsa).length, hsaNow: mine.filter((p) => p.hsa).length,
    plansBefore: pm.length,
  } : null;

  const sorted = [...mine].sort((a, b) => metalOrder(a.metal) - metalOrder(b.metal) || (a.prem40 ?? 0) - (b.prem40 ?? 0));
  // Null, not zero, when the carrier's plans have no filed enrollment yet (new plan ids, or a year ahead of filings).
  const enrolled = mine.some((p) => p.enrollment != null) ? mine.reduce((s, p) => s + (p.enrollment ?? 0), 0) : null;
  const marketEnrolled = all.reduce((s, p) => s + (p.enrollment ?? 0), 0);
  return {
    state, year, market, plans: sorted, marketPlans: all.length, issuers: issuers.size, position, bench, benchHeld, lowestHeld, extras, changes,
    enrolled, marketEnrolled, networks: [...nNow], types: [...new Set(mine.map((p) => p.planType).filter(Boolean))] as string[],
    standardized: mine.filter((p) => p.standardized).length, hsa: mine.filter((p) => p.hsa).length, tiered: mine.filter((p) => p.tiered).length,
    oon: mine.filter((p) => p.outOfNetwork).length, communityRated: state === "VT", hasCostShare: mine.some((p) => p.costShare),
  };
}

/** All carriers in one state × market × year, for the market comparison page. */
export async function marketProducts(state: string, market: string, year?: number) {
  const { latest } = await qhpYears();
  const y = year ?? latest.get(state);
  if (!y) return null;
  const plans = await withFilings((await loadPlans({ state, year: y })).filter((p) => p.market === market));
  const issuers = [...new Map(plans.map((p) => [p.issuerId, p.issuerName ?? p.issuerId])).entries()];
  const metals = [...new Set(plans.map((p) => metalKey(p.metal)))].sort((a, b) => metalOrder(a) - metalOrder(b));
  const grid = issuers.map(([id, name]) => {
    const ps = plans.filter((p) => p.issuerId === id);
    return {
      id, name, plans: ps.length, enrolled: ps.reduce((s, p) => s + (p.enrollment ?? 0), 0),
      types: [...new Set(ps.map((p) => p.planType).filter(Boolean))] as string[],
      networks: [...new Set(ps.map((p) => p.networkName).filter(Boolean))] as string[],
      hsa: ps.filter((p) => p.hsa).length, oon: ps.filter((p) => p.outOfNetwork).length, statewide: ps.some((p) => p.statewide),
      counties: Math.max(0, ...ps.map((p) => p.counties ?? 0)),
      byMetal: Object.fromEntries(metals.map((m) => { const x = ps.filter((p) => metalKey(p.metal) === m); return [m, { n: x.length, low: min(x.filter((p) => p.prem40).map((p) => p.prem40!)), ded: median(x.map((p) => p.dedInd!).filter((v) => v != null)) }]; })),
      extras: DIFFERENTIATORS.map((d) => ({ label: d.label, share: ps.length ? ps.filter((p) => has(p, d)).length / ps.length : 0 })),
    };
  }).sort((a, b) => b.enrolled - a.enrolled || b.plans - a.plans);
  const lowByMetal = Object.fromEntries(metals.map((m) => [m, min(grid.map((g) => g.byMetal[m].low).filter((x): x is number => x != null))]));
  return { state, market, year: y, metals, grid, lowByMetal, bench: market === "Individual" ? benchmarks(plans) : [], plans, communityRated: state === "VT" };
}
