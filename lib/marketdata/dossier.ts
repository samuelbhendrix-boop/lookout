import { createHash } from "node:crypto";
import { db } from "../db";
import { issuerPatternFor } from "./queries";
import { NE_STATES } from "./products";

/**
 * Product dossiers: every commercial (individual + small-group) product each carrier files in New England, with
 * everything public about it in one row — line-up, design, network, price position, enrollment trend, filed rate
 * change and loss ratio — and a rule-based read of the strategy behind it. Plus each carrier's book by segment (MLR)
 * so the product moves sit in context.
 *
 * Sources: CMS rate filings (URRT, RatePlan) for the full line-up incl. off-exchange; Exchange plan files (QhpPlan)
 * for designs and premiums; CMS MLR filings (MarketFinancial) for the book. A product = state + carrier + product
 * name + plan type, which merges the same product filed separately for individual and small group (e.g. MA's merged
 * market).
 */

const METALS = ["Platinum", "Gold", "Silver", "Expanded Bronze", "Bronze", "Catastrophic"];
const metalKey = (m: string | null) => (m === "Expanded Bronze" ? "Bronze" : m ?? "—");
const median = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const wavg = (xs: Array<{ v: number | null | undefined; w: number }>) => { const ok = xs.filter((x) => x.v != null && Number.isFinite(x.v) && x.w > 0); const w = ok.reduce((s, x) => s + x.w, 0); return w ? ok.reduce((s, x) => s + x.v! * x.w, 0) / w : null; };
const norm = (s: string) => s.toLowerCase().replace(/\b20\d\d\b/g, "").replace(/\((indv|individual|small group|sm grp|sg)\)|-\s*(ind|sm grp)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** Drop the market suffix carriers add when they file one product twice ("-Sm Grp", "(INDV)"). */
const displayName = (s: string) => s.replace(/\s*\((indv|individual|small group|sm grp|sg)\)\s*$/i, "").replace(/\s*-\s*(ind|indv|sm grp|small group)\s*$/i, "").trim();
const NARROW = /\b(select|focus|value|narrow|tiered|tier|essential|easy|direct|local)\b/i;

export type Tag = { id: string; label: string; why: string; tone: "good" | "bad" | "neutral" };
export type Archetype = { label: string; why: string };
export type Product = {
  key: string; state: string; company: string; name: string; planType: string | null; markets: string[]; productIds: string[];
  plans: number; newPlans: number; terminated: number; onExchange: number; metals: string[];
  enrolled: number; enrolledPrev: number | null; growth: number | null; share: number | null;
  rateChange: number | null; marketRateChange: number | null; pmpm: number | null; marketPmpm: number | null; filedLossRatio: number | null;
  priceIndex: number | null; networks: string[]; dedMin: number | null; dedMax: number | null; hsa: number; tiered: number; oon: number; standardized: number;
  qhpPlans: number; statewide: boolean; counties: number | null; cheapestIn: string[];
  tags: Tag[]; archetype: Archetype; planYear: number;
};
export type Book = { state: string; segment: string; year: number; lives: number; livesBefore: number | null; yearBefore: number | null; pmpm: number | null; marketPmpm: number | null; lossRatio: number | null; marketLossRatio: number | null; share: number | null; read: string[] };

// ── All NE products, computed once and cached briefly (every page view reuses it) ─────────────────────────────
let cache: { at: number; data: Promise<Product[]> } | null = null;
export function allProducts(): Promise<Product[]> {
  if (cache && Date.now() - cache.at < 10 * 60e3) return cache.data;
  const data = buildProducts().catch((e) => { cache = null; throw e; });
  cache = { at: Date.now(), data };
  return data;
}

type RP = { state: string; company: string; market: string; productId: string; productName: string; planType: string | null; planId: string; metal: string | null; category: string; onExchange: boolean; rateChange: number | null; enrollment: number | null; ratePmpm: number | null; expLossRatio: number | null; planYear: number };

async function buildProducts(): Promise<Product[]> {
  const years = await db.$queryRaw<Array<{ y: number }>>`SELECT DISTINCT "planYear" y FROM "RatePlan" WHERE state = ANY(${NE_STATES}) ORDER BY 1 DESC LIMIT 2`;
  if (!years.length) return [];
  const [ly, py] = [years[0].y, years[1]?.y ?? null];
  const rows = await db.$queryRaw<RP[]>`
    SELECT DISTINCT ON ("planYear", "planId") state, company, market, "productId", "productName", "planType", "planId", metal, category, "onExchange", "rateChange", enrollment, "ratePmpm", "expLossRatio", "planYear"
    FROM "RatePlan" WHERE state = ANY(${NE_STATES}) AND "planYear" = ANY(${[ly, py].filter((x) => x != null)})
    ORDER BY "planYear", "planId", "effectiveDate" DESC`;

  // Market context per state × market (latest year): enrollment-weighted renewing rate change, avg PMPM, total enrollment.
  const mkt = new Map<string, { rate: number | null; pmpm: number | null; enrolled: number }>();
  for (const st of NE_STATES) for (const m of ["Individual", "Small Group"]) {
    const xs = rows.filter((r) => r.planYear === ly && r.state === st && r.market === m && r.category !== "Terminated");
    mkt.set(`${st}|${m}`, {
      rate: wavg(xs.filter((r) => r.category === "Renewing").map((r) => ({ v: r.rateChange, w: r.enrollment ?? 0 }))),
      pmpm: wavg(xs.filter((r) => (r.ratePmpm ?? 0) > 0).map((r) => ({ v: r.ratePmpm, w: r.enrollment ?? 0 }))),
      enrolled: xs.reduce((s, r) => s + (r.enrollment ?? 0), 0),
    });
  }

  // Exchange designs and price position, latest QHP year per state.
  const qy = await db.qhpPlan.groupBy({ by: ["state"], where: { state: { in: NE_STATES } }, _max: { year: true } });
  const qhp = (await Promise.all(qy.map((q) => db.qhpPlan.findMany({ where: { state: q.state, year: q._max.year! }, select: { state: true, market: true, year: true, productId: true, planId: true, metal: true, prem40: true, networkName: true, dedInd: true, hsa: true, tiered: true, outOfNetwork: true, standardized: true, statewide: true, counties: true, issuerId: true } })))).flat();
  const medByMetal = new Map<string, number | null>();
  const lowByMetal = new Map<string, number>();
  for (const p of qhp) {
    const k = `${p.state}|${p.market}|${metalKey(p.metal)}`;
    if (!medByMetal.has(k)) {
      const ps = qhp.filter((q) => `${q.state}|${q.market}|${metalKey(q.metal)}` === k && q.prem40);
      medByMetal.set(k, median(ps.map((q) => q.prem40!)));
      if (ps.length) lowByMetal.set(k, Math.min(...ps.map((q) => q.prem40!)));
    }
  }
  const qhpByProduct = new Map<string, typeof qhp>();
  for (const p of qhp) (qhpByProduct.get(p.productId) ?? qhpByProduct.set(p.productId, []).get(p.productId)!).push(p);

  const keyOf = (r: RP) => `${r.state}|${r.company}|${norm(r.productName)}|${r.planType ?? ""}`;
  const groups = new Map<string, { cur: RP[]; prev: RP[] }>();
  for (const r of rows) {
    const g = groups.get(keyOf(r)) ?? groups.set(keyOf(r), { cur: [], prev: [] }).get(keyOf(r))!;
    (r.planYear === ly ? g.cur : g.prev).push(r);
  }
  // A product renamed between years still matches on its HIOS product id.
  const prevById = new Map<string, RP[]>();
  for (const r of rows) if (r.planYear === py) (prevById.get(r.productId) ?? prevById.set(r.productId, []).get(r.productId)!).push(r);

  const out: Product[] = [];
  for (const [key, g] of groups) {
    if (!g.cur.length) continue; // gone this year: shows up as terminated plans when the filing lists them
    const live = g.cur.filter((r) => r.category !== "Terminated");
    const ids = [...new Set(g.cur.map((r) => r.productId))];
    const prev = g.prev.length ? g.prev : ids.flatMap((id) => prevById.get(id) ?? []);
    const enrolled = live.reduce((s, r) => s + (r.enrollment ?? 0), 0);
    const enrolledPrev = prev.length ? prev.filter((r) => r.category !== "Terminated").reduce((s, r) => s + (r.enrollment ?? 0), 0) : null;
    const markets = [...new Set(g.cur.map((r) => r.market))];
    const byMkt = markets.map((m) => ({ m, w: live.filter((r) => r.market === m).reduce((s, r) => s + (r.enrollment ?? 0), 0) || 1 }));
    const st = g.cur[0].state;
    const q = ids.flatMap((id) => qhpByProduct.get(id) ?? []);
    const ratios = q.filter((p) => p.prem40).map((p) => { const m = medByMetal.get(`${p.state}|${p.market}|${metalKey(p.metal)}`); return m ? p.prem40! / m : null; }).filter((x): x is number => x != null);
    const cheapestIn = [...new Set(q.filter((p) => p.prem40 && p.prem40 === lowByMetal.get(`${p.state}|${p.market}|${metalKey(p.metal)}`)).map((p) => `${metalKey(p.metal)}${markets.length > 1 || p.market === "SHOP" ? ` (${p.market === "SHOP" ? "small group" : "individual"})` : ""}`))];
    const deds = q.map((p) => p.dedInd).filter((x): x is number => x != null);
    const lr = wavg(live.filter((r) => r.expLossRatio != null && r.expLossRatio > 0.3 && r.expLossRatio < 1.5).map((r) => ({ v: r.expLossRatio, w: r.enrollment ?? 0 })));
    const p: Product = {
      key, state: st, company: g.cur[0].company, name: displayName([...g.cur].sort((a, b) => (b.enrollment ?? 0) - (a.enrollment ?? 0))[0].productName), planType: g.cur[0].planType, markets, productIds: ids,
      plans: live.length, newPlans: live.filter((r) => r.category === "New").length, terminated: g.cur.filter((r) => r.category === "Terminated").length,
      onExchange: live.filter((r) => r.onExchange).length,
      metals: [...new Set(live.map((r) => metalKey(r.metal)))].filter((m) => m !== "—").sort((a, b) => METALS.indexOf(a) - METALS.indexOf(b)),
      enrolled, enrolledPrev, growth: enrolledPrev && enrolledPrev >= 100 ? enrolled / enrolledPrev - 1 : null,
      share: (() => { const t = markets.reduce((s, m) => s + (mkt.get(`${st}|${m}`)?.enrolled ?? 0), 0); return t ? enrolled / t : null; })(),
      rateChange: wavg(live.filter((r) => r.category === "Renewing").map((r) => ({ v: r.rateChange, w: r.enrollment ?? 0 }))),
      marketRateChange: wavg(byMkt.map((x) => ({ v: mkt.get(`${st}|${x.m}`)?.rate, w: x.w }))),
      pmpm: wavg(live.filter((r) => (r.ratePmpm ?? 0) > 0).map((r) => ({ v: r.ratePmpm, w: r.enrollment ?? 0 }))),
      marketPmpm: wavg(byMkt.map((x) => ({ v: mkt.get(`${st}|${x.m}`)?.pmpm, w: x.w }))),
      filedLossRatio: lr, priceIndex: ratios.length ? ratios.reduce((s, x) => s + x, 0) / ratios.length : null,
      networks: [...new Set(q.map((p) => p.networkName?.trim()).filter(Boolean) as string[])], dedMin: deds.length ? Math.min(...deds) : null, dedMax: deds.length ? Math.max(...deds) : null,
      hsa: q.filter((p) => p.hsa).length, tiered: q.filter((p) => p.tiered).length, oon: q.filter((p) => p.outOfNetwork).length, standardized: q.filter((p) => p.standardized).length,
      qhpPlans: q.length, statewide: q.some((p) => p.statewide), counties: q.length ? Math.max(0, ...q.map((p) => p.counties ?? 0)) || null : null, cheapestIn,
      tags: [], archetype: { label: "", why: "" }, planYear: ly,
    };
    p.tags = tagsFor(p);
    p.archetype = archetypeOf(p);
    out.push(p);
  }
  return out.sort((a, b) => b.enrolled - a.enrolled);
}

const pts = (x: number) => `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)} pts`;
const pc = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`;

/** Each tag states its evidence; thresholds are deliberately coarse so a tag means something. */
export function tagsFor(p: Pick<Product, "growth" | "enrolledPrev" | "enrolled" | "rateChange" | "marketRateChange" | "priceIndex" | "newPlans" | "plans" | "terminated" | "hsa" | "qhpPlans" | "tiered" | "networks" | "name" | "onExchange" | "filedLossRatio" | "share" | "cheapestIn" | "oon">): Tag[] {
  const t: Tag[] = [];
  if (p.plans === 0 && p.terminated > 0) t.push({ id: "exiting", label: "Discontinued", why: `All ${p.terminated} plans filed as terminated`, tone: "bad" });
  else if (!p.enrolledPrev && p.newPlans === p.plans && p.plans > 0) t.push({ id: "new", label: "New product", why: `All ${p.plans} plans are new this year`, tone: "neutral" });
  if (p.growth != null && p.growth >= 0.1) t.push({ id: "growing", label: "Growing", why: `Enrollment ${pc(p.growth)} (${p.enrolledPrev!.toLocaleString()} → ${p.enrolled.toLocaleString()})`, tone: "good" });
  if (p.growth != null && p.growth <= -0.1) t.push({ id: "shrinking", label: "Shrinking", why: `Enrollment ${pc(p.growth)} (${p.enrolledPrev!.toLocaleString()} → ${p.enrolled.toLocaleString()})`, tone: "bad" });
  if (p.rateChange != null && p.marketRateChange != null) {
    const d = p.rateChange - p.marketRateChange;
    if (d <= -0.02) t.push({ id: "underprice", label: "Pricing for share", why: `Renewal increase ${pc(p.rateChange)} vs market ${pc(p.marketRateChange)} (${pts(d)})`, tone: "good" });
    if (d >= 0.02) t.push({ id: "overprice", label: "Pricing for margin", why: `Renewal increase ${pc(p.rateChange)} vs market ${pc(p.marketRateChange)} (${pts(d)})`, tone: "bad" });
  }
  if (p.priceIndex != null && p.priceIndex <= 0.95) t.push({ id: "low", label: "Low price", why: `Exchange premiums average ${Math.round(p.priceIndex * 100)}% of the market median for the same metal${p.cheapestIn.length ? `; cheapest ${p.cheapestIn.join(", ")}` : ""}`, tone: "good" });
  else if (p.cheapestIn.length) t.push({ id: "low", label: "Price leader", why: `Cheapest plan in ${p.cheapestIn.join(", ")}`, tone: "good" });
  if (p.priceIndex != null && p.priceIndex >= 1.1) t.push({ id: "high", label: "Premium price", why: `Exchange premiums average ${Math.round(p.priceIndex * 100)}% of the market median for the same metal`, tone: "neutral" });
  if (p.newPlans >= 2 && p.newPlans / Math.max(1, p.plans) >= 0.3 && p.newPlans < p.plans) t.push({ id: "expanding", label: "Expanding line-up", why: `${p.newPlans} of ${p.plans} plans are new`, tone: "neutral" });
  if (p.terminated >= 2 && p.terminated / (p.plans + p.terminated) >= 0.25 && p.plans > 0) t.push({ id: "pruning", label: "Pruning plans", why: `${p.terminated} plans terminated, ${p.plans} remain`, tone: "neutral" });
  if (p.qhpPlans >= 2 && p.hsa / p.qhpPlans >= 0.5) t.push({ id: "hsa", label: "HSA-led", why: `${p.hsa} of ${p.qhpPlans} exchange plans are HSA-eligible`, tone: "neutral" });
  if (p.tiered > 0 || p.networks.some((n) => NARROW.test(n)) || NARROW.test(p.name)) t.push({ id: "narrow", label: p.tiered ? "Tiered network" : "Limited network", why: p.tiered ? `${p.tiered} plans use tiered cost sharing by provider` : `Network or product named ${[...p.networks, p.name].find((n) => NARROW.test(n))}`, tone: "neutral" });
  if (p.oon > 0) t.push({ id: "oon", label: "Out-of-network cover", why: `${p.oon} exchange plans pay out of network`, tone: "neutral" });
  if (p.onExchange === 0 && p.plans > 0) t.push({ id: "offx", label: "Off-exchange only", why: "None of its plans are sold on the exchange (brokers and direct only)", tone: "neutral" });
  if (p.filedLossRatio != null && p.filedLossRatio <= 0.78) t.push({ id: "margin", label: "Fat filed margin", why: `Projects paying ${Math.round(p.filedLossRatio * 100)}% of premium in claims (URRT)`, tone: "neutral" });
  if (p.filedLossRatio != null && p.filedLossRatio >= 0.92) t.push({ id: "thin", label: "Thin filed margin", why: `Projects paying ${Math.round(p.filedLossRatio * 100)}% of premium in claims (URRT)`, tone: "neutral" });
  if (p.share != null && p.share >= 0.2) t.push({ id: "anchor", label: "Market anchor", why: `${Math.round(p.share * 100)}% of the state market's filed enrollment`, tone: "neutral" });
  return t;
}

/** One-line read of what the carrier is doing with the product, from the tags. First matching rule wins. */
export function archetypeOf(p: { tags: Tag[]; enrolled: number }): Archetype {
  const has = (id: string) => p.tags.find((t) => t.id === id);
  const why = (...ids: string[]) => ids.map(has).filter(Boolean).map((t) => t!.why).join("; ");
  if (has("exiting")) return { label: "Exit", why: why("exiting") };
  if (has("new")) return { label: "Launch", why: why("new", "low", "high", "narrow") };
  if ((has("underprice") || has("low")) && has("growing")) return { label: "Share grab", why: why("underprice", "low", "growing") };
  if (has("overprice") && (has("shrinking") || has("thin"))) return { label: "Margin repair", why: why("overprice", "shrinking", "thin") };
  if (has("overprice") && has("margin")) return { label: "Harvest", why: why("overprice", "margin") };
  if (has("shrinking") && has("pruning")) return { label: "Wind-down", why: why("shrinking", "pruning") };
  if (has("narrow") && (has("low") || has("underprice"))) return { label: "Value network play", why: why("narrow", "low", "underprice") };
  if (has("anchor") && !has("overprice") && !has("underprice")) return { label: "Defend the core", why: why("anchor") };
  if (has("expanding")) return { label: "Building out", why: why("expanding", "growing") };
  if (has("overprice")) return { label: "Raising price", why: why("overprice") };
  if (has("underprice") || has("low")) return { label: "Price competitor", why: why("underprice", "low") };
  if (has("shrinking")) return { label: "Losing ground", why: why("shrinking") };
  if (has("growing")) return { label: "Growing", why: why("growing") };
  return { label: "Steady", why: p.enrolled ? "Pricing and enrollment in line with the market" : "No filed enrollment yet" };
}

// ── Per competitor ────────────────────────────────────────────────────────────────────────────────────────────
type Comp = { id?: string; name: string; aliases: string[]; issuerPattern: string | null };
const reFor = (c: Comp) => { try { return new RegExp(issuerPatternFor(c), "i"); } catch { return null; } };

export async function competitorDossier(c: Comp, state?: string) {
  const re = reFor(c);
  const products = re ? (await allProducts()).filter((p) => re.test(p.company) && (!state || p.state === state)) : [];
  const book = re ? await bookOf(re, state) : [];
  return { products, book, summary: summarize(products, book) };
}

/** Segment-level book trend from MLR filings: lives, premium PMPM and loss ratio vs the state-segment market. */
async function bookOf(re: RegExp, state?: string): Promise<Book[]> {
  const rows = await db.marketFinancial.findMany({ where: { state: state ? state : { in: NE_STATES } }, select: { year: true, state: true, segment: true, company: true, premium: true, claims: true, coveredLives: true, memberMonths: true } });
  if (!rows.length) return [];
  const ly = Math.max(...rows.map((r) => r.year));
  const out: Book[] = [];
  for (const st of state ? [state] : NE_STATES) for (const seg of ["INDIVIDUAL", "SMALL_GROUP", "LARGE_GROUP"]) {
    const sum = (xs: typeof rows) => xs.reduce((a, r) => ({ p: a.p + r.premium, c: a.c + r.claims, l: a.l + r.coveredLives, mm: a.mm + r.memberMonths }), { p: 0, c: 0, l: 0, mm: 0 });
    const at = (y: number, mine: boolean) => sum(rows.filter((r) => r.year === y && r.state === st && r.segment === seg && (!mine || re.test(r.company))));
    const m = at(ly, true);
    if (m.l < 500) continue;
    const yb = [ly - 3, ly - 2, ly - 1].find((y) => at(y, true).l >= 500) ?? null;
    const before = yb != null ? at(yb, true) : null;
    const mk = at(ly, false);
    const b: Book = {
      state: st, segment: seg, year: ly, lives: m.l, livesBefore: before?.l ?? null, yearBefore: yb,
      pmpm: m.mm ? m.p / m.mm : null, marketPmpm: mk.mm ? mk.p / mk.mm : null,
      lossRatio: m.p >= 250_000 ? m.c / m.p : null, marketLossRatio: mk.p ? mk.c / mk.p : null, share: mk.l ? m.l / mk.l : null, read: [],
    };
    if (b.livesBefore) { const g = b.lives / b.livesBefore - 1; if (Math.abs(g) >= 0.1) b.read.push(`${g > 0 ? "Grew" : "Shrank"} ${Math.abs(Math.round(g * 100))}% since ${yb}`); }
    if (b.pmpm && b.marketPmpm) { const d = b.pmpm / b.marketPmpm - 1; if (Math.abs(d) >= 0.07) b.read.push(`premium ${Math.abs(Math.round(d * 100))}% ${d > 0 ? "above" : "below"} market`); }
    if (b.lossRatio != null && b.marketLossRatio != null) { const d = b.lossRatio - b.marketLossRatio; if (Math.abs(d) >= 0.04) b.read.push(`loss ratio ${Math.round(b.lossRatio * 100)}% vs market ${Math.round(b.marketLossRatio * 100)}%${d > 0 ? " (under pressure to raise rates)" : " (room to cut price)"}`); }
    out.push(b);
  }
  // Self-funded (ASO) members where the state publishes them (MA CHIA, NH Insurance Dept).
  for (const st of (state ? [state] : NE_STATES).filter((x) => ["MA", "NH"].includes(x))) {
    const latest = await db.marketEnrollment.findFirst({ where: { state: st, funding: "SELF_INSURED" }, orderBy: { asOf: "desc" } });
    if (!latest) continue;
    const rows = await db.marketEnrollment.findMany({ where: { state: st, funding: "SELF_INSURED", source: latest.source, asOf: latest.asOf }, select: { payer: true, members: true } });
    const total = rows.reduce((s, r) => s + r.members, 0);
    const mine = rows.filter((r) => re.test(r.payer)).reduce((s, r) => s + r.members, 0);
    if (mine < 100) continue;
    out.push({ state: st, segment: "SELF_FUNDED", year: latest.asOf.getUTCFullYear(), lives: mine, livesBefore: null, yearBefore: null, pmpm: null, marketPmpm: null, lossRatio: null, marketLossRatio: null, share: total ? mine / total : null, read: [`${total ? Math.round((mine / total) * 100) : 0}% of the state's self-funded members (${latest.source === "ma_chia" ? "CHIA" : "NH Insurance Dept"}${latest.estimated ? " estimate" : ""}, ${latest.asOf.toISOString().slice(0, 7)})`] });
  }
  return out;
}

const SEG: Record<string, string> = { INDIVIDUAL: "individual", SMALL_GROUP: "small group", LARGE_GROUP: "large group", SELF_FUNDED: "self-funded (ASO)" };
/** Rule-written strategy summary: a few sentences per state, biggest products first. */
function summarize(products: Product[], book: Book[]): string[] {
  const out: string[] = [];
  for (const st of [...new Set([...products.map((p) => p.state), ...book.map((b) => b.state)])].sort()) {
    const ps = products.filter((p) => p.state === st && (p.plans > 0 || p.terminated > 0));
    const total = ps.reduce((s, p) => s + p.enrolled, 0);
    const lead = ps[0];
    const counts = new Map<string, Product[]>();
    for (const p of ps) (counts.get(p.archetype.label) ?? counts.set(p.archetype.label, []).get(p.archetype.label)!).push(p);
    const moves = [...counts.entries()].filter(([l]) => l !== "Steady").sort((a, b) => b[1].reduce((s, p) => s + p.enrolled, 0) - a[1].reduce((s, p) => s + p.enrolled, 0))
      .slice(0, 3).map(([l, xs]) => `${l.toLowerCase()} on ${xs.slice(0, 2).map((p) => p.name).join(" and ")}${xs.length > 2 ? ` (+${xs.length - 2} more)` : ""}`);
    const bk = book.filter((b) => b.state === st && b.read.length).map((b) => `${SEG[b.segment]}: ${b.read.join(", ")}`);
    const parts = [
      ps.length ? `${ps.length} product${ps.length === 1 ? "" : "s"}, ${total.toLocaleString()} filed members${lead && total ? `; ${lead.name} carries ${Math.round((lead.enrolled / total) * 100)}%` : ""}.` : "",
      moves.length ? `Moves: ${moves.join("; ")}.` : ps.length ? "No product stands out from the market on price, growth or line-up." : "",
      bk.length ? `Book (${book[0]?.year}) — ${bk.join("; ")}.` : "",
    ].filter(Boolean);
    if (parts.length) out.push(`${st}: ${parts.join(" ")}`);
  }
  return out;
}

/** Which competitor each product belongs to, for the cross-competitor matrix. */
export async function stateMatrix(workspaceId: string, state: string) {
  const comps = await db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } });
  const products = (await allProducts()).filter((p) => p.state === state);
  const matchers = comps.map((c) => ({ c, re: reFor(c) }));
  const rows = new Map<string, { id: string; name: string; products: Product[] }>();
  for (const p of products) {
    const m = matchers.find((x) => x.re?.test(p.company));
    const k = m?.c.id ?? `x:${p.company}`;
    (rows.get(k) ?? rows.set(k, { id: m?.c.id ?? "", name: m?.c.name ?? p.company, products: [] }).get(k)!).products.push(p);
  }
  return [...rows.values()].map((r) => {
    const live = r.products.filter((p) => p.plans > 0);
    const enrolled = live.reduce((s, p) => s + p.enrolled, 0);
    const prevKnown = r.products.filter((p) => p.enrolledPrev != null);
    const prev = prevKnown.reduce((s, p) => s + p.enrolledPrev!, 0);
    const counts = new Map<string, number>();
    for (const p of live) counts.set(p.archetype.label, (counts.get(p.archetype.label) ?? 0) + p.enrolled);
    return {
      ...r, tracked: !!r.id, enrolled, growth: prev >= 200 ? prevKnown.reduce((s, p) => s + p.enrolled, 0) / prev - 1 : null,
      rateChange: wavg(live.map((p) => ({ v: p.rateChange, w: p.enrolled }))), marketRateChange: wavg(live.map((p) => ({ v: p.marketRateChange, w: p.enrolled }))),
      priceIndex: wavg(live.map((p) => ({ v: p.priceIndex, w: p.enrolled || 1 }))),
      newPlans: live.reduce((s, p) => s + p.newPlans, 0), terminated: r.products.reduce((s, p) => s + p.terminated, 0), plans: live.reduce((s, p) => s + p.plans, 0),
      lead: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l).filter((l) => l !== "Steady").slice(0, 2),
      top: live[0] ?? null,
    };
  }).sort((a, b) => Number(b.tracked) - Number(a.tracked) || b.enrolled - a.enrolled);
}

// ── Optional AI narrative (needs ANTHROPIC_API_KEY) ───────────────────────────────────────────────────────────
export type Narrative = { text: string; generatedAt: string; model: string } | null;
export async function strategyNarrative(competitorId: string, name: string, d: Awaited<ReturnType<typeof competitorDossier>>, news: Array<{ title: string; when: Date }>): Promise<Narrative> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !d.products.length) return null;
  const facts = [
    ...d.book.map((b) => b.segment === "SELF_FUNDED" ? `BOOK ${b.state} self-funded (ASO) ${b.year}: ${Math.round(b.lives).toLocaleString()} members administered; ${b.read.join("; ")}` : `BOOK ${b.state} ${SEG[b.segment]} ${b.year}: ${Math.round(b.lives).toLocaleString()} lives${b.livesBefore ? ` (was ${Math.round(b.livesBefore).toLocaleString()} in ${b.yearBefore})` : ""}; premium PMPM ${b.pmpm?.toFixed(0)} vs market ${b.marketPmpm?.toFixed(0)}; loss ratio ${b.lossRatio != null ? Math.round(b.lossRatio * 100) : "?"}% vs market ${b.marketLossRatio != null ? Math.round(b.marketLossRatio * 100) : "?"}%`),
    ...d.products.slice(0, 25).map((p) => `PRODUCT ${p.state} "${p.name}" ${p.planType ?? ""} [${p.markets.join("+")}]: ${p.plans} plans (+${p.newPlans} new, -${p.terminated} terminated), metals ${p.metals.join("/")}, ${p.enrolled.toLocaleString()} filed members${p.growth != null ? ` (${pc(p.growth)} y/y)` : ""}; tags: ${p.tags.map((t) => `${t.label} (${t.why})`).join("; ") || "none"}`),
    ...news.slice(0, 6).map((n) => `NEWS ${n.when.toISOString().slice(0, 10)}: ${n.title}`),
  ].join("\n");
  const hash = createHash("sha1").update(facts).digest("hex").slice(0, 16);
  const id = `cache:strategy:${competitorId}`;
  const cached = await db.rateFile.findUnique({ where: { id } });
  const c = cached?.stats as { hash?: string; n?: Narrative } | null;
  if (c?.hash === hash && c.n) return c.n;
  const model = process.env.CLASSIFIER_MODEL ?? "claude-haiku-5-5";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(40_000),
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: 600,
        system: `You are a competitive-intelligence analyst at a New England health insurer. From the facts given about ${name}'s commercial (individual, small group, large group) business, write its product strategy in 3-5 plain sentences: where it is pushing for growth, where it is protecting margin or retreating, how it positions price and network, and the one thing a competitor should watch. Use only the facts given; name products and states; no hedging filler, no headers, no bullet points. If the facts conflict, say so.`,
        messages: [{ role: "user", content: facts }],
      }),
    });
    if (!res.ok) return c?.n ?? null;
    const body = (await res.json()) as { content?: Array<{ text?: string }> };
    const text = body.content?.[0]?.text?.trim();
    if (!text) return c?.n ?? null;
    const n: Narrative = { text, generatedAt: new Date().toISOString(), model };
    const data = { carrier: "_cache", carrierName: "_cache", network: "strategy", url: "", status: "cache", stats: JSON.parse(JSON.stringify({ hash, n })), processedAt: new Date() };
    await db.rateFile.upsert({ where: { id }, create: { id, ...data }, update: data });
    return n;
  } catch {
    return c?.n ?? null;
  }
}
