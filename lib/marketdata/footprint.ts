import { db } from "../db";
import { competitorsOf } from "../homecharts";
import { NE_STATES } from "./products";

/**
 * Where each competitor competes: per state × segment, fully insured members, share of the state-segment market and
 * loss ratio (claims ÷ premium) from CMS loss-ratio filings, plus whether it sells on the state's exchange.
 */
export const SEGMENTS = ["INDIVIDUAL", "SMALL_GROUP", "LARGE_GROUP"] as const;
export type Seg = (typeof SEGMENTS)[number];
export type Cell = { lives: number; share: number; lossRatio: number | null; prevLives: number | null };

export async function footprint(workspaceId: string) {
  const { comps, match } = await competitorsOf(workspaceId);
  const ly = (await db.marketFinancial.aggregate({ where: { state: { in: NE_STATES } }, _max: { year: true } }))._max.year;
  if (!ly) return { year: null, rows: [], totals: new Map<string, number>() };
  const rows = await db.marketFinancial.groupBy({ by: ["company", "state", "segment", "year"], where: { state: { in: NE_STATES }, year: { in: [ly, ly - 1] } }, _sum: { coveredLives: true, premium: true, claims: true } });
  const totals = new Map<string, number>();
  const acc = new Map<string, { lives: number; prem: number; claims: number; prev: number }>();
  for (const r of rows) {
    const lives = r._sum.coveredLives ?? 0;
    if (r.year === ly) totals.set(`${r.state}|${r.segment}`, (totals.get(`${r.state}|${r.segment}`) ?? 0) + lives);
    const c = match(r.company);
    if (!c) continue;
    const k = `${c.id}|${r.state}|${r.segment}`;
    const a = acc.get(k) ?? acc.set(k, { lives: 0, prem: 0, claims: 0, prev: 0 }).get(k)!;
    if (r.year === ly) { a.lives += lives; a.prem += r._sum.premium ?? 0; a.claims += r._sum.claims ?? 0; } else a.prev += lives;
  }
  // Exchange participation, latest plan year per state.
  const qy = await db.qhpPlan.groupBy({ by: ["state"], where: { state: { in: NE_STATES } }, _max: { year: true } });
  const qhp = (await Promise.all(qy.map((q) => db.qhpPlan.findMany({ where: { state: q.state, year: q._max.year! }, distinct: ["issuerName", "market"], select: { state: true, issuerName: true, market: true } })))).flat();
  const onX = new Map<string, Set<string>>();
  for (const q of qhp) { const c = match(q.issuerName ?? ""); if (c) { const k = `${c.id}|${q.state}`; (onX.get(k) ?? onX.set(k, new Set()).get(k)!).add(q.market === "SHOP" ? "SHOP" : "Individual"); } }

  const out = comps.map((c) => {
    const cells: Record<string, Partial<Record<Seg, Cell>>> = {};
    let lives = 0, prem = 0, claims = 0, prev = 0;
    for (const st of NE_STATES) for (const seg of SEGMENTS) {
      const a = acc.get(`${c.id}|${st}|${seg}`);
      if (!a || a.lives < 50) continue;
      (cells[st] ??= {})[seg] = { lives: a.lives, share: a.lives / (totals.get(`${st}|${seg}`) || 1), lossRatio: a.prem >= 250_000 ? a.claims / a.prem : null, prevLives: a.prev || null };
      lives += a.lives; prem += a.prem; claims += a.claims; prev += a.prev;
    }
    const exchange = Object.fromEntries(NE_STATES.map((st) => [st, [...(onX.get(`${c.id}|${st}`) ?? [])]]).filter(([, v]) => v.length));
    const neTotal = [...totals.values()].reduce((s, v) => s + v, 0);
    return { id: c.id, name: c.name, tier: c.tier, cells, exchange, lives, share: neTotal ? lives / neTotal : 0, lossRatio: prem >= 250_000 ? claims / prem : null, growth: prev > 500 ? lives / prev - 1 : null, states: Object.keys(cells).length };
  }).sort((a, b) => b.lives - a.lives || a.name.localeCompare(b.name));
  return { year: ly, rows: out, totals };
}
