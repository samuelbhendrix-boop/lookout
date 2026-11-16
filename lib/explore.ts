import { db } from "./db";
import { issuerPatternFor } from "./marketdata/queries";
import { leverage } from "./marketdata/mrf/leverage";
import { ARCHETYPES, type Marketing, type MarketedProduct } from "./marketing/extract";
import { siteFor } from "./marketing/sites";

/**
 * The Competitors → Data table: one flat pull across everything the site holds about competitors' products, at a row
 * level the user picks. Plan and product rows come from rate filings (enrollment, rate change) joined to exchange plan
 * files (benefit design, premiums); carrier rows add financial filings and hospital price position; marketed-product
 * rows come from the monthly read of carriers' own websites. Every level carries the carrier's marketing flags.
 */
export const NE = ["MA", "CT", "RI", "NH", "VT", "ME"];
export const LEVELS = [
  { key: "plan", label: "Plans", hint: "Every filed plan: design, premium, enrollment, rate change" },
  { key: "product", label: "Products", hint: "Plans rolled up to the product" },
  { key: "carrier", label: "Carriers", hint: "Carrier by state and segment: members, premium, loss ratio, prices" },
  { key: "marketed", label: "Marketed products", hint: "How each product is sold, from carriers' own websites" },
] as const;
export type Level = (typeof LEVELS)[number]["key"];
export type ColType = "text" | "int" | "usd" | "pct" | "pts" | "x" | "bool" | "year";
export type Col = { key: string; label: string; group: string; type: ColType; on?: boolean; agg?: "sum" | "avg"; hint?: string };
export type Cell = string | number | boolean | null;
export type Filters = { states: string[]; from: number; to: number; carriers: string[]; segments: string[]; networks: string[]; metals: string[]; marketed: string[] };
export type Pull = { level: Level; cols: Col[]; rows: Cell[][]; total: number; truncated: boolean; options: { carriers: string[]; segments: string[]; networks: string[]; metals: string[]; years: number[] }; notes: string[] };
export const MAX_ROWS = 6000;
export const MARKETED = ARCHETYPES.map((a) => ({ key: a.key, label: a.label }));

type Comp = { id: string; name: string; aliases: string[]; issuerPattern: string | null };
const tidy = (s: string) => s.replace(/,?\s+(Inc\.?|LLC|Corp\.?|Corporation|Company|Co\.)$/i, "").replace(/\s+/g, " ").trim();
function resolver(comps: Comp[]) {
  const res = comps.flatMap((c) => { try { return [{ name: c.name, re: new RegExp(issuerPatternFor(c), "i") }]; } catch { return []; } });
  const cache = new Map<string, string>();
  return (company: string | null | undefined) => {
    const k = company ?? "";
    let v = cache.get(k);
    if (v === undefined) { v = res.find((r) => r.re.test(k))?.name ?? tidy(k); cache.set(k, v); }
    return v;
  };
}
const seg = (m: string | null | undefined) => (!m ? null : /large/i.test(m) ? "Large group" : /small|shop/i.test(m) ? "Small group" : /indiv/i.test(m) ? "Individual" : m);
const chg = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null && b !== 0 ? a / b - 1 : null);
const diff = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null ? a - b : null);
const wavg = (xs: Array<{ v: number | null | undefined; w: number | null | undefined }>) => {
  const ok = xs.filter((x) => x.v != null);
  if (!ok.length) return null;
  const tw = ok.reduce((t, x) => t + (x.w ?? 0), 0);
  return tw > 0 ? ok.reduce((t, x) => t + x.v! * (x.w ?? 0), 0) / tw : ok.reduce((t, x) => t + x.v!, 0) / ok.length;
};
const uniq = (xs: Array<string | null | undefined>) => [...new Set(xs.filter((x): x is string => !!x))].sort();

// ── How each carrier markets its products (from the monthly website read) ────────────────────────────────────────
type Mk = { flags: Record<string, boolean>; partners: string[]; products: MarketedProduct[]; label: string };
async function marketing(comps: Comp[]): Promise<Map<string, Mk>> {
  const rows = await db.rateFile.findMany({ where: { id: { startsWith: "cache:marketing:" } }, select: { id: true, stats: true } });
  const bySite = new Map(rows.map((r) => [r.id.slice("cache:marketing:".length), ((r.stats ?? {}) as { m?: Marketing }).m] as const));
  const out = new Map<string, Mk>();
  for (const c of comps) {
    const m = bySite.get(siteFor(c.name)?.key ?? "");
    if (!m?.products?.length) continue;
    out.set(c.name, {
      label: m.label, products: m.products,
      flags: Object.fromEntries(ARCHETYPES.map((a) => [a.key, m.products.some((p) => a.test(p))])),
      partners: uniq([...(m.partners ?? []).map((p) => p.name), ...m.products.flatMap((p) => p.partners.map((x) => x.name))]),
    });
  }
  return out;
}
const MK_COLS: Col[] = [...ARCHETYPES.map((a) => ({ key: `mk_${a.key}`, label: `Markets: ${a.label.toLowerCase()}`, group: "How the carrier markets", type: "bool" as const, hint: "From the carrier's own website (carrier-wide, not this plan)" })),
  { key: "mk_partners", label: "Vendors and partners", group: "How the carrier markets", type: "text", hint: "Named on the carrier's pages or in partnership news" }];
const mkCells = (mk: Mk | undefined): Cell[] => [...ARCHETYPES.map((a) => (mk ? !!mk.flags[a.key] : null)), mk ? mk.partners.slice(0, 12).join(", ") : null];
const mkPass = (mk: Mk | undefined, want: string[]) => !want.length || (!!mk && want.every((k) => mk.flags[k]));

// ── Plans (and the base for products and carriers) ───────────────────────────────────────────────────────────────
type P = {
  year: number; state: string; carrier: string; entity: string; segment: string | null; productId: string | null; product: string | null; plan: string; planId: string;
  status: string | null; onExchange: boolean | null; metal: string | null; ntype: string | null; nname: string | null; statewide: boolean | null; counties: number | null;
  hsa: boolean | null; tiered: boolean | null; referral: boolean | null; oon: boolean | null; std: boolean | null; isNew: boolean | null; av: number | null; ded: number | null; moop: number | null; coins: number | null;
  prem40: number | null; premMin: number | null; premMax: number | null; pmpm: number | null; rateChange: number | null; members: number | null;
};
async function plans(f: Filters, who: (c: string | null | undefined) => string): Promise<Map<string, P>> {
  const years = { gte: f.from - 1, lte: f.to };
  const [rp, qhp] = await Promise.all([
    db.ratePlan.findMany({ where: { state: { in: f.states }, planYear: years }, select: { planYear: true, state: true, company: true, market: true, productId: true, productName: true, planId: true, planName: true, metal: true, planType: true, onExchange: true, category: true, rateChange: true, enrollment: true, ratePmpm: true } }),
    db.qhpPlan.findMany({ where: { state: { in: f.states }, year: years }, select: { year: true, state: true, issuerName: true, market: true, planId: true, productId: true, name: true, metal: true, planType: true, networkName: true, statewide: true, counties: true, isNew: true, standardized: true, hsa: true, tiered: true, referral: true, outOfNetwork: true, av: true, dedInd: true, moopInd: true, coinsurance: true, prem40: true, prem40Min: true, prem40Max: true } }),
  ]);
  const m = new Map<string, P>();
  for (const r of rp) {
    const k = `${r.planYear}:${r.planId}`;
    const prev = m.get(k);
    // The same plan can sit in two filings (a refiling): keep the one with enrollment.
    if (prev && (prev.members ?? -1) >= (r.enrollment ?? -1)) continue;
    m.set(k, { year: r.planYear, state: r.state, carrier: who(r.company), entity: tidy(r.company), segment: seg(r.market), productId: r.productId, product: r.productName, plan: r.planName, planId: r.planId, status: r.category, onExchange: r.onExchange, metal: r.metal, ntype: r.planType, nname: null, statewide: null, counties: null, hsa: null, tiered: null, referral: null, oon: null, std: null, isNew: r.category === "New", av: null, ded: null, moop: null, coins: null, prem40: null, premMin: null, premMax: null, pmpm: r.ratePmpm, rateChange: r.rateChange, members: r.enrollment });
  }
  for (const q of qhp) {
    const k = `${q.year}:${q.planId}`;
    const base = m.get(k) ?? { year: q.year, state: q.state, carrier: who(q.issuerName), entity: tidy(q.issuerName ?? ""), segment: seg(q.market), productId: q.productId, product: null, plan: q.name, planId: q.planId, status: null, onExchange: true, metal: q.metal, ntype: q.planType, nname: null, statewide: null, counties: null, hsa: null, tiered: null, referral: null, oon: null, std: null, isNew: q.isNew, av: null, ded: null, moop: null, coins: null, prem40: null, premMin: null, premMax: null, pmpm: null, rateChange: null, members: null };
    m.set(k, { ...base, metal: base.metal ?? q.metal, ntype: base.ntype ?? q.planType, nname: q.networkName, statewide: q.statewide, counties: q.counties, hsa: q.hsa, tiered: q.tiered, referral: q.referral, oon: q.outOfNetwork, std: q.standardized, av: q.av, ded: q.dedInd, moop: q.moopInd, coins: q.coinsurance, prem40: q.prem40, premMin: q.prem40Min, premMax: q.prem40Max });
  }
  return m;
}
const planPass = (p: P, f: Filters, mk: Map<string, Mk>, inRange = true) =>
  (!inRange || p.year >= f.from) && (!f.carriers.length || f.carriers.includes(p.carrier)) && (!f.segments.length || f.segments.includes(p.segment ?? "")) &&
  (!f.networks.length || f.networks.includes(p.ntype ?? "")) && (!f.metals.length || f.metals.includes(p.metal ?? "")) && mkPass(mk.get(p.carrier), f.marketed);

export async function pull(level: Level, f: Filters, comps: Comp[]): Promise<Pull> {
  const who = resolver(comps);
  const mk = await marketing(comps);
  const notes: string[] = [];
  let cols: Col[] = [], rows: Cell[][] = [];
  let options = { carriers: [] as string[], segments: [] as string[], networks: [] as string[], metals: [] as string[], years: [] as number[] };

  if (level === "marketed") {
    cols = [
      { key: "carrier", label: "Carrier", group: "Product", type: "text", on: true }, { key: "product", label: "Product", group: "Product", type: "text", on: true }, { key: "family", label: "Family", group: "Product", type: "text" },
      { key: "segments", label: "Segments", group: "Product", type: "text", on: true }, { key: "states", label: "States", group: "Product", type: "text" }, { key: "buyer", label: "Aimed at", group: "Product", type: "text" },
      { key: "ptype", label: "Plan type", group: "Network", type: "text", on: true }, { key: "network", label: "Network model", group: "Network", type: "text", on: true }, { key: "netdetail", label: "Network detail", group: "Network", type: "text" }, { key: "pcp", label: "PCP required", group: "Network", type: "bool" },
      { key: "virtual", label: "Virtual-first", group: "Design", type: "bool", on: true }, { key: "virtdetail", label: "Virtual detail", group: "Design", type: "text" }, { key: "cost", label: "Cost design", group: "Design", type: "text", on: true }, { key: "funding", label: "Funding", group: "Design", type: "text", on: true },
      { key: "partners", label: "Vendors and partners", group: "Marketing", type: "text", on: true }, { key: "pitch", label: "Pitch", group: "Marketing", type: "text", on: true }, { key: "claims", label: "Claims made", group: "Marketing", type: "text" }, { key: "source", label: "Source page", group: "Marketing", type: "text" },
    ];
    const all = [...mk].flatMap(([carrier, m]) => m.products.map((p) => ({ carrier, p })));
    options = { carriers: uniq(all.map((x) => x.carrier)), segments: [], networks: uniq(all.map((x) => x.p.network)), metals: [], years: [] };
    const st = new Set(f.states);
    rows = all.filter(({ carrier, p }) => (!f.carriers.length || f.carriers.includes(carrier)) && (!p.states.length || p.states.some((s) => st.has(s.toUpperCase()) || /new england|all|national/i.test(s))) &&
      (!f.networks.length || f.networks.includes(p.network)) && (!f.segments.length || f.segments.some((s) => p.segments.some((x) => x.toLowerCase().includes(s.toLowerCase().split(" ")[0])))) && f.marketed.every((k) => ARCHETYPES.find((a) => a.key === k)?.test(p)))
      .map(({ carrier, p }) => [carrier, p.name, p.family ?? null, p.segments.join(", "), p.states.join(", "), p.targetBuyer ?? null, p.planType ?? null, p.network, p.networkDetail ?? null, p.pcpRequired ?? null, p.virtualFirst, p.virtualDetail ?? null, p.costDesign.join(", "), p.funding.join(", "), p.partners.map((x) => (x.role ? `${x.name} (${x.role})` : x.name)).join("; "), p.pitch ?? null, p.claims.join("; "), p.sources[0] ?? null]);
    notes.push(`Read by AI from ${mk.size} carriers' own websites and brochures, refreshed monthly. No year: this is what each carrier markets now. Check the source page before quoting.`);
  } else {
    const base = await plans(f, who);
    const all = [...base.values()];
    options = { carriers: uniq(all.map((p) => p.carrier)), segments: uniq(all.map((p) => p.segment)), networks: uniq(all.map((p) => p.ntype)), metals: uniq(all.map((p) => p.metal)), years: [...new Set(all.map((p) => p.year))].sort() };

    if (level === "plan") {
      cols = [
        { key: "year", label: "Year", group: "Plan", type: "year", on: true }, { key: "state", label: "State", group: "Plan", type: "text", on: true }, { key: "carrier", label: "Carrier", group: "Plan", type: "text", on: true }, { key: "entity", label: "Filing entity", group: "Plan", type: "text" },
        { key: "segment", label: "Segment", group: "Plan", type: "text", on: true }, { key: "product", label: "Product", group: "Plan", type: "text" }, { key: "plan", label: "Plan", group: "Plan", type: "text", on: true }, { key: "planId", label: "Plan ID", group: "Plan", type: "text" },
        { key: "status", label: "Status", group: "Plan", type: "text", hint: "New, renewing or terminated in the rate filing" }, { key: "onx", label: "On exchange", group: "Plan", type: "bool" },
        { key: "metal", label: "Metal", group: "Design", type: "text", on: true }, { key: "ntype", label: "Network type", group: "Design", type: "text", on: true }, { key: "nname", label: "Network name", group: "Design", type: "text" }, { key: "statewide", label: "Statewide", group: "Design", type: "bool" }, { key: "counties", label: "Counties", group: "Design", type: "int" },
        { key: "hsa", label: "HSA", group: "Design", type: "bool" }, { key: "tiered", label: "Tiered network", group: "Design", type: "bool" }, { key: "referral", label: "Referral needed", group: "Design", type: "bool" }, { key: "oon", label: "Out-of-network benefit", group: "Design", type: "bool" }, { key: "std", label: "Standardized design", group: "Design", type: "bool" },
        { key: "av", label: "Actuarial value", group: "Design", type: "pct" }, { key: "ded", label: "Deductible", group: "Design", type: "usd", on: true, agg: "avg" }, { key: "moop", label: "Out-of-pocket max", group: "Design", type: "usd", agg: "avg" }, { key: "coins", label: "Coinsurance", group: "Design", type: "pct" },
        { key: "prem40", label: "Premium, age 40", group: "Price", type: "usd", on: true, agg: "avg", hint: "Monthly, median across the state's rating areas" }, { key: "premMin", label: "Lowest rating area", group: "Price", type: "usd", agg: "avg" }, { key: "premMax", label: "Highest rating area", group: "Price", type: "usd", agg: "avg" },
        { key: "pmpm", label: "Filed premium PMPM", group: "Price", type: "usd", agg: "avg" }, { key: "rate", label: "Filed rate change", group: "Price", type: "pct", on: true, agg: "avg" },
        { key: "members", label: "Members", group: "Members", type: "int", on: true, agg: "sum", hint: "Enrollment at the time of the rate filing" },
        { key: "premChg", label: "Premium vs last year", group: "Change vs last year", type: "pct", on: true, agg: "avg" }, { key: "dedChg", label: "Deductible vs last year", group: "Change vs last year", type: "usd", agg: "avg" }, { key: "memChg", label: "Members vs last year", group: "Change vs last year", type: "pct", agg: "avg" },
        ...MK_COLS,
      ];
      rows = all.filter((p) => planPass(p, f, mk)).map((p) => {
        const prev = base.get(`${p.year - 1}:${p.planId}`);
        return [p.year, p.state, p.carrier, p.entity, p.segment, p.product, p.plan, p.planId, p.status, p.onExchange, p.metal, p.ntype, p.nname, p.statewide, p.counties, p.hsa, p.tiered, p.referral, p.oon, p.std, p.av, p.ded, p.moop, p.coins, p.prem40, p.premMin, p.premMax, p.pmpm, p.rateChange, p.members, chg(p.prem40, prev?.prem40), diff(p.ded, prev?.ded), chg(p.members, prev?.members), ...mkCells(mk.get(p.carrier))];
      });
      notes.push("Individual and small-group plans, from CMS rate-review filings (enrollment, rate change) joined to exchange plan files (design, premiums). Design and premium columns are blank for plans not in the exchange files.");
    }

    if (level === "product") {
      const groups = new Map<string, P[]>();
      for (const p of all) { if (!planPass(p, f, mk, false)) continue; const k = `${p.year}|${p.state}|${p.entity}|${p.segment}|${p.productId}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(p); }
      const sum = (ps: P[]) => { const live = ps.filter((p) => p.status !== "Terminated"); const m = live.filter((p) => p.members != null); return { plans: live.length, members: m.length ? m.reduce((t, p) => t + p.members!, 0) : null, prem: wavg(live.map((p) => ({ v: p.prem40, w: p.members }))) }; };
      cols = [
        { key: "year", label: "Year", group: "Product", type: "year", on: true }, { key: "state", label: "State", group: "Product", type: "text", on: true }, { key: "carrier", label: "Carrier", group: "Product", type: "text", on: true }, { key: "entity", label: "Filing entity", group: "Product", type: "text" },
        { key: "segment", label: "Segment", group: "Product", type: "text", on: true }, { key: "product", label: "Product", group: "Product", type: "text", on: true }, { key: "plans", label: "Plans", group: "Product", type: "int", on: true, agg: "sum" }, { key: "newPlans", label: "New plans", group: "Product", type: "int", agg: "sum" }, { key: "dropped", label: "Plans dropped", group: "Product", type: "int", agg: "sum" },
        { key: "ntypes", label: "Network types", group: "Design", type: "text", on: true }, { key: "metals", label: "Metals", group: "Design", type: "text" }, { key: "hsa", label: "Has HSA plan", group: "Design", type: "bool" }, { key: "tiered", label: "Has tiered plan", group: "Design", type: "bool" },
        { key: "dedMin", label: "Lowest deductible", group: "Design", type: "usd", agg: "avg" }, { key: "dedMax", label: "Highest deductible", group: "Design", type: "usd", agg: "avg" },
        { key: "prem40", label: "Avg premium, age 40", group: "Price", type: "usd", on: true, agg: "avg", hint: "Weighted by members where enrollment is filed" }, { key: "premLow", label: "Cheapest plan, age 40", group: "Price", type: "usd", agg: "avg" }, { key: "rate", label: "Avg filed rate change", group: "Price", type: "pct", on: true, agg: "avg" },
        { key: "members", label: "Members", group: "Members", type: "int", on: true, agg: "sum" },
        { key: "memChg", label: "Members vs last year", group: "Change vs last year", type: "pct", on: true, agg: "avg" }, { key: "premChg", label: "Premium vs last year", group: "Change vs last year", type: "pct", agg: "avg" }, { key: "plansChg", label: "Plans vs last year", group: "Change vs last year", type: "int", agg: "sum" },
        ...MK_COLS,
      ];
      for (const [k, ps] of groups) {
        const a = ps[0];
        if (a.year < f.from) continue;
        const live = ps.filter((p) => p.status !== "Terminated"), s = sum(ps);
        const prevPs = groups.get(`${a.year - 1}|${a.state}|${a.entity}|${a.segment}|${a.productId}`), pv = prevPs ? sum(prevPs) : null;
        const deds = live.map((p) => p.ded).filter((x): x is number => x != null), prems = live.map((p) => p.prem40).filter((x): x is number => x != null);
        rows.push([a.year, a.state, a.carrier, a.entity, a.segment, ps.find((p) => p.product)?.product ?? a.productId ?? k, s.plans, live.filter((p) => p.isNew).length, ps.length - live.length, uniq(live.map((p) => p.ntype)).join(", "), uniq(live.map((p) => p.metal)).join(", "), live.some((p) => p.hsa), live.some((p) => p.tiered),
          deds.length ? Math.min(...deds) : null, deds.length ? Math.max(...deds) : null, s.prem, prems.length ? Math.min(...prems) : null, wavg(live.map((p) => ({ v: p.rateChange, w: p.members }))), s.members, chg(s.members, pv?.members), chg(s.prem, pv?.prem), pv ? s.plans - pv.plans : null, ...mkCells(mk.get(a.carrier))]);
      }
      notes.push("Plans grouped by the carrier's filed product. Averages are weighted by members where enrollment is filed. Individual and small group only: carriers don't file large-group products.");
    }

    if (level === "carrier") {
      const SEG: Record<string, string> = { INDIVIDUAL: "Individual", SMALL_GROUP: "Small group", LARGE_GROUP: "Large group" };
      const [fin, lev] = await Promise.all([
        db.marketFinancial.findMany({ where: { state: { in: f.states }, year: { gte: f.from - 1, lte: f.to } }, select: { year: true, state: true, company: true, groupName: true, segment: true, premium: true, claims: true, coveredLives: true, memberMonths: true } }),
        leverage().catch(() => null),
      ]);
      type C = { year: number; state: string; segment: string; carrier: string; lives: number; premium: number; claims: number; mm: number; fin: boolean; plans: P[] };
      const g = new Map<string, C>();
      const get = (year: number, state: string, segment: string, carrier: string) => { const k = `${year}|${state}|${segment}|${carrier}`; return g.get(k) ?? g.set(k, { year, state, segment, carrier, lives: 0, premium: 0, claims: 0, mm: 0, fin: false, plans: [] }).get(k)!; };
      for (const r of fin) { const c = get(r.year, r.state, SEG[r.segment], who(`${r.company} ${r.groupName ?? ""}`) === tidy(`${r.company} ${r.groupName ?? ""}`) ? who(r.company) : who(`${r.company} ${r.groupName ?? ""}`)); c.lives += r.coveredLives; c.premium += r.premium; c.claims += r.claims; c.mm += r.memberMonths; c.fin = true; }
      for (const p of all) if (p.segment && p.status !== "Terminated") get(p.year, p.state, p.segment, p.carrier).plans.push(p);
      const tot = new Map<string, number>();
      for (const c of g.values()) { const k = `${c.year}|${c.state}|${c.segment}`; tot.set(k, (tot.get(k) ?? 0) + Math.max(0, c.lives)); }
      const price = new Map<string, { x: number | null; peers: number | null }>();
      for (const c of lev?.carriers ?? []) price.set(who(c.carrierName), { x: c.uniform ? null : c.median, peers: c.uniform ? null : c.vsPeers });
      const m = (c: C) => { const filed = c.plans.filter((p) => p.members != null); return { members: c.fin ? c.lives : filed.length ? filed.reduce((t, p) => t + p.members!, 0) : null, pmpm: c.fin && c.mm > 0 ? c.premium / c.mm : null, lr: c.fin && c.premium > 0 ? c.claims / c.premium : null, share: c.fin && tot.get(`${c.year}|${c.state}|${c.segment}`) ? Math.max(0, c.lives) / tot.get(`${c.year}|${c.state}|${c.segment}`)! : null }; };
      cols = [
        { key: "year", label: "Year", group: "Carrier", type: "year", on: true }, { key: "state", label: "State", group: "Carrier", type: "text", on: true }, { key: "carrier", label: "Carrier", group: "Carrier", type: "text", on: true }, { key: "segment", label: "Segment", group: "Carrier", type: "text", on: true },
        { key: "members", label: "Members", group: "Financial filings", type: "int", on: true, agg: "sum", hint: "Covered lives in loss-ratio filings (through 2024); enrollment in rate filings after that" }, { key: "share", label: "Market share", group: "Financial filings", type: "pct", on: true, agg: "sum" },
        { key: "pmpm", label: "Premium PMPM", group: "Financial filings", type: "usd", on: true, agg: "avg" }, { key: "lr", label: "Loss ratio", group: "Financial filings", type: "pct", on: true, agg: "avg", hint: "Claims ÷ premium" },
        { key: "plans", label: "Plans filed", group: "Plan filings", type: "int", agg: "sum" }, { key: "rate", label: "Avg filed rate change", group: "Plan filings", type: "pct", on: true, agg: "avg" }, { key: "prem40", label: "Avg premium, age 40", group: "Plan filings", type: "usd", agg: "avg" }, { key: "silver", label: "Cheapest silver, age 40", group: "Plan filings", type: "usd", agg: "avg" },
        { key: "hmo", label: "Share of plans HMO/EPO", group: "Plan filings", type: "pct", agg: "avg" }, { key: "tieredShare", label: "Share of plans tiered", group: "Plan filings", type: "pct", agg: "avg" },
        { key: "px", label: "Hospital prices × Medicare", group: "Provider prices (now)", type: "x", agg: "avg", hint: "Median across hospitals, all New England, from the latest negotiated-rate files" }, { key: "peers", label: "Prices vs other carriers", group: "Provider prices (now)", type: "pct", agg: "avg" },
        { key: "memChg", label: "Members vs last year", group: "Change vs last year", type: "pct", on: true, agg: "avg" }, { key: "shareChg", label: "Share vs last year", group: "Change vs last year", type: "pts", agg: "avg" }, { key: "pmpmChg", label: "Premium PMPM vs last year", group: "Change vs last year", type: "pct", agg: "avg" }, { key: "lrChg", label: "Loss ratio vs last year", group: "Change vs last year", type: "pts", agg: "avg" },
        ...MK_COLS,
      ];
      const segs = new Set<string>();
      for (const c of g.values()) {
        segs.add(c.segment);
        if (c.year < f.from || (f.carriers.length && !f.carriers.includes(c.carrier)) || (f.segments.length && !f.segments.includes(c.segment)) || !mkPass(mk.get(c.carrier), f.marketed)) continue;
        const ps = c.plans.filter((p) => (!f.networks.length || f.networks.includes(p.ntype ?? "")) && (!f.metals.length || f.metals.includes(p.metal ?? "")));
        if ((f.networks.length || f.metals.length) && !ps.length) continue;
        const cur = m(c), prevC = g.get(`${c.year - 1}|${c.state}|${c.segment}|${c.carrier}`), pv = prevC ? m(prevC) : null;
        if (cur.members == null && !ps.length) continue;
        const silver = ps.filter((p) => /silver/i.test(p.metal ?? "") && p.prem40 != null).map((p) => p.prem40!);
        const pr = price.get(c.carrier);
        rows.push([c.year, c.state, c.carrier, c.segment, cur.members, cur.share, cur.pmpm, cur.lr, ps.length || null, wavg(ps.map((p) => ({ v: p.rateChange, w: p.members }))), wavg(ps.map((p) => ({ v: p.prem40, w: p.members }))), silver.length ? Math.min(...silver) : null,
          ps.length ? ps.filter((p) => /hmo|epo/i.test(p.ntype ?? "")).length / ps.length : null, ps.some((p) => p.tiered != null) ? ps.filter((p) => p.tiered).length / ps.filter((p) => p.tiered != null).length : null,
          pr?.x ?? null, pr?.peers ?? null, chg(cur.members, pv?.members), diff(cur.share, pv?.share), chg(cur.pmpm, pv?.pmpm), diff(cur.lr, pv?.lr), ...mkCells(mk.get(c.carrier))]);
      }
      options.segments = [...segs].sort();
      options.years = [...new Set([...g.values()].map((c) => c.year))].sort();
      notes.push("Members, share, premium and loss ratio come from CMS loss-ratio filings (fully insured, through 2024). Plan-filing columns cover individual and small group, 2025 on. Hospital prices are the current New England figure and don't vary by year or state.");
    }
  }
  if (!mk.size) notes.push("Marketing columns are empty until the monthly read of carrier websites has run.");
  // Newest year first, then carrier, then the row's name: a sensible order before the user sorts.
  const yi = cols.findIndex((c) => c.key === "year"), ci = cols.findIndex((c) => c.key === "carrier"), mi = cols.findIndex((c) => c.key === "members");
  rows.sort((x, y) => (yi >= 0 ? (y[yi] as number) - (x[yi] as number) : 0) || String(x[ci] ?? "").localeCompare(String(y[ci] ?? "")) || (mi >= 0 ? ((y[mi] as number) ?? -1) - ((x[mi] as number) ?? -1) : 0));
  const total = rows.length;
  return { level, cols, rows: rows.slice(0, MAX_ROWS), total, truncated: total > MAX_ROWS, options, notes };
}
