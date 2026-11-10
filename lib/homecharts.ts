import { db } from "./db";
import { issuerPatternFor } from "./marketdata/queries";
import { leverage } from "./marketdata/mrf/leverage";

/**
 * Data behind the Home page charts: pricing trends, network negotiations, sales and products for the workspace's own
 * competitors. Every series is grouped to a competitor through its filing-name pattern; anything else is "rest of market".
 */
type Comp = { id: string; name: string; aliases: string[]; issuerPattern: string | null };
export type Series = { name: string; competitorId?: string; points: Array<{ x: string; y: number | null }> };

const re = (p: string) => { try { return p ? new RegExp(p, "i") : null; } catch { return null; } };
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Competitor ids ordered by fully insured New England covered lives (latest loss-ratio year), then name: the color order. */
export async function rankCompetitors(workspaceId: string): Promise<string[]> {
  const comps = await db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } });
  const year = (await db.marketFinancial.aggregate({ where: { state: { in: ["MA", "CT", "RI", "NH", "VT", "ME"] } }, _max: { year: true } }))._max.year;
  const rows = year ? await db.marketFinancial.groupBy({ by: ["company"], where: { year, state: { in: ["MA", "CT", "RI", "NH", "VT", "ME"] } }, _sum: { coveredLives: true } }) : [];
  const lives = new Map<string, number>();
  const matchers = comps.map((c) => ({ c, r: re(issuerPatternFor(c as Comp)) }));
  for (const r of rows) { const m = matchers.find((x) => x.r?.test(r.company)); if (m) lives.set(m.c.id, (lives.get(m.c.id) ?? 0) + (r._sum.coveredLives ?? 0)); }
  return comps.sort((a, b) => (lives.get(b.id) ?? 0) - (lives.get(a.id) ?? 0) || a.name.localeCompare(b.name)).map((c) => c.id);
}

export async function competitorsOf(workspaceId: string) {
  const comps = await db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true, tier: true } });
  const matchers = comps.map((c) => ({ c, r: re(issuerPatternFor(c as Comp)) }));
  return { comps, match: (name: string) => matchers.find((m) => m.r?.test(name))?.c ?? null };
}
type Match = Awaited<ReturnType<typeof competitorsOf>>["match"];

/** Fully insured premium per member per month by year (CMS loss-ratio filings), per competitor + the market. */
export async function premiumTrend(match: Match, state: string, segment: "INDIVIDUAL" | "SMALL_GROUP" | "LARGE_GROUP") {
  const rows = await db.marketFinancial.findMany({ where: { state, segment }, select: { year: true, company: true, premium: true, memberMonths: true } });
  const years = [...new Set(rows.map((r) => r.year))].sort();
  const acc = new Map<string, { id?: string; byYear: Map<number, { p: number; mm: number }> }>();
  const add = (key: string, id: string | undefined, y: number, p: number, mm: number) => {
    const a = acc.get(key) ?? acc.set(key, { id, byYear: new Map() }).get(key)!;
    const v = a.byYear.get(y) ?? { p: 0, mm: 0 };
    a.byYear.set(y, { p: v.p + p, mm: v.mm + mm });
  };
  for (const r of rows) {
    if (!r.memberMonths) continue;
    const c = match(r.company);
    if (c) add(c.name, c.id, r.year, r.premium, r.memberMonths);
    add("Market", undefined, r.year, r.premium, r.memberMonths);
  }
  const series: Series[] = [...acc.entries()].map(([name, a]) => ({ name, competitorId: a.id, points: years.map((y) => { const v = a.byYear.get(y); return { x: String(y), y: v && v.mm >= 12_000 ? v.p / v.mm : null }; }) }))
    .filter((s) => s.points.filter((p) => p.y != null).length >= 2);
  return { years: years.map(String), series };
}

/** ACA rate filings: enrollment-weighted requested change on renewing plans, by competitor and plan year. */
export async function filedRateChanges(match: Match, state: string) {
  const rows = await db.$queryRaw<Array<{ company: string; planYear: number; w: number; e: number }>>`
    WITH latest AS (SELECT DISTINCT ON ("planId", "planYear") company, "planYear", "rateChange", enrollment, category FROM "RatePlan" WHERE state = ${state} ORDER BY "planId", "planYear", "effectiveDate" DESC)
    SELECT company, "planYear", SUM("rateChange" * enrollment)::float AS w, SUM(enrollment)::float AS e
    FROM latest WHERE category = 'Renewing' AND enrollment > 0 AND "rateChange" IS NOT NULL GROUP BY company, "planYear"`;
  const acc = new Map<string, { id?: string; y: Map<number, { w: number; e: number }> }>();
  for (const r of rows) {
    for (const key of [match(r.company)?.name, "Market"]) {
      if (!key) continue;
      const a = acc.get(key) ?? acc.set(key, { id: match(r.company)?.id, y: new Map() }).get(key)!;
      if (key === "Market") a.id = undefined;
      const v = a.y.get(r.planYear) ?? { w: 0, e: 0 };
      a.y.set(r.planYear, { w: v.w + r.w, e: v.e + r.e });
    }
  }
  const years = [...new Set(rows.map((r) => r.planYear))].sort();
  return { years: years.map(String), rows: [...acc.entries()].map(([name, a]) => ({ name, competitorId: a.id, values: years.map((y) => { const v = a.y.get(y); return v && v.e >= 200 ? v.w / v.e : null; }) })).filter((r) => r.values.some((v) => v != null)) };
}

/** Exchange plans: cheapest silver premium (age 40) and plan count, by competitor and year. */
export async function exchangeTrend(match: Match, state: string) {
  const rows = await db.qhpPlan.findMany({ where: { state, market: "Individual" }, select: { year: true, issuerName: true, metal: true, prem40: true } });
  const years = [...new Set(rows.map((r) => r.year))].sort();
  const acc = new Map<string, { id: string; silver: Map<number, number[]>; plans: Map<number, number> }>();
  for (const r of rows) {
    const c = match(r.issuerName ?? "");
    if (!c) continue;
    const a = acc.get(c.name) ?? acc.set(c.name, { id: c.id, silver: new Map(), plans: new Map() }).get(c.name)!;
    a.plans.set(r.year, (a.plans.get(r.year) ?? 0) + 1);
    if (r.metal === "Silver" && r.prem40) (a.silver.get(r.year) ?? a.silver.set(r.year, []).get(r.year)!).push(r.prem40);
  }
  const ys = years.map(String);
  return {
    years: ys,
    silver: [...acc.entries()].map(([name, a]) => ({ name, competitorId: a.id, points: years.map((y) => ({ x: String(y), y: a.silver.get(y)?.length ? Math.min(...a.silver.get(y)!) : null })) })).filter((s) => s.points.some((p) => p.y != null)),
    plans: [...acc.entries()].map(([name, a]) => ({ name, competitorId: a.id, points: years.map((y) => ({ x: String(y), y: a.plans.get(y) ?? null })) })),
  };
}

/** Sales: Form 5500 accounts won and lost (employers moving between insured carriers), latest filing year. */
export async function accountMoves(match: Match) {
  const ev = await db.marketEvent.findMany({ where: { kind: { in: ["account_won", "account_lost"] } }, select: { kind: true, carrier: true, occurredAt: true, data: true } });
  const latest = Math.max(...ev.map((e) => e.occurredAt.getUTCFullYear()), 0);
  const acc = new Map<string, { id: string; won: number; lost: number; wonLives: number; lostLives: number }>();
  for (const e of ev) {
    if (e.occurredAt.getUTCFullYear() < latest - 1) continue;
    const c = match(e.carrier);
    if (!c) continue;
    const a = acc.get(c.name) ?? acc.set(c.name, { id: c.id, won: 0, lost: 0, wonLives: 0, lostLives: 0 }).get(c.name)!;
    const n = Number((e.data as { participants?: number } | null)?.participants ?? 0);
    if (e.kind === "account_won") { a.won++; a.wonLives += n; } else { a.lost++; a.lostLives += n; }
  }
  return { years: `${latest - 1}–${latest}`, rows: [...acc.entries()].map(([name, a]) => ({ name, competitorId: a.id, ...a })).sort((x, y) => (y.wonLives - y.lostLives) - (x.wonLives - x.lostLives)) };
}

/** Network negotiations: what each carrier pays hospitals as a multiple of Medicare, and recent negotiated-rate moves. */
export async function networkPosition(match: Match) {
  const lev = await leverage();
  const position = (lev?.carriers ?? []).filter((c) => !c.uniform && c.median != null).map((c) => ({ name: c.carrierName, competitorId: match(c.carrierName)?.id, median: c.median!, vsPeers: c.vsPeers, hospitals: c.hospitals })).sort((a, b) => a.median - b.median);
  const moves = await db.marketEvent.findMany({ where: { kind: { in: ["rate_change", "network_add", "network_drop"] }, occurredAt: { gte: new Date(Date.now() - 365 * 864e5) } }, select: { kind: true, carrier: true, data: true } });
  const acc = new Map<string, { id?: string; up: number; down: number; adds: number; drops: number; changes: number[] }>();
  for (const m of moves) {
    const c = match(m.carrier);
    const key = c?.name ?? m.carrier;
    const a = acc.get(key) ?? acc.set(key, { id: c?.id, up: 0, down: 0, adds: 0, drops: 0, changes: [] }).get(key)!;
    const med = Number((m.data as { median?: number } | null)?.median ?? NaN);
    if (m.kind === "rate_change") { if (med > 0) a.up++; else if (med < 0) a.down++; if (!Number.isNaN(med)) a.changes.push(med); }
    if (m.kind === "network_add") a.adds++;
    if (m.kind === "network_drop") a.drops++;
  }
  return { month: lev?.month ?? null, position, moves: [...acc.entries()].map(([name, a]) => ({ name, competitorId: a.id, up: a.up, down: a.down, adds: a.adds, drops: a.drops, median: median(a.changes) })).sort((a, b) => (b.up + b.down + b.adds + b.drops) - (a.up + a.down + a.adds + a.drops)) };
}
