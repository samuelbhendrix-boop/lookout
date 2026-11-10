import { db } from "../db";
import { issuerPatternFor } from "./queries";

/**
 * Self-funded (ASO) membership: employers that pay their own claims and buy administration from a carrier. CMS's
 * loss-ratio filings leave it out entirely, which understates the national carriers and BCBSMA. Two New England
 * states publish it by carrier:
 *  - Massachusetts CHIA Enrollment Trends (quarterly, actual counts; small and large group)
 *  - New Hampshire Insurance Department (annual, estimated from published shares; large group)
 * Elsewhere only Form 5500 Schedule C gives a sample (on each competitor's products page).
 */
export const SELF_FUNDED_STATES = ["MA", "NH"];

export type SelfFundedRow = { key: string; label: string; competitorId: string | null; members: number; share: number; prevMembers: number | null };
export type SelfFunded = { state: string; source: string; asOf: Date; estimated: boolean; total: number; rows: SelfFundedRow[] };

const re = (p: string) => { try { return p ? new RegExp(p, "i") : null; } catch { return null; } };

/** Self-funded membership by competitor for each state that publishes it (latest report, with the one a year earlier). */
export async function selfFunded(workspaceId: string, states = SELF_FUNDED_STATES): Promise<SelfFunded[]> {
  const comps = await db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } });
  const matchers = comps.map((c) => ({ c, r: re(issuerPatternFor(c)) }));
  const group = (payer: string) => { const m = matchers.find((x) => x.r?.test(payer)); return m ? { key: m.c.id, label: m.c.name, competitorId: m.c.id as string | null } : { key: `p:${payer}`, label: payer, competitorId: null }; };
  const out: SelfFunded[] = [];
  for (const state of states) {
    const latest = await db.marketEnrollment.findFirst({ where: { state, funding: "SELF_INSURED" }, orderBy: { asOf: "desc" } });
    if (!latest) continue;
    const [cur, prevAll] = await Promise.all([
      db.marketEnrollment.findMany({ where: { state, funding: "SELF_INSURED", source: latest.source, asOf: latest.asOf } }),
      db.marketEnrollment.findMany({ where: { state, funding: "SELF_INSURED", source: latest.source, asOf: { lt: latest.asOf } }, select: { asOf: true, payer: true, members: true } }),
    ]);
    const target = latest.asOf.getTime() - 365 * 864e5;
    const prevDate = [...new Set(prevAll.map((p) => p.asOf.getTime()))].sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
    const prev = prevDate && Math.abs(prevDate - target) < 45 * 864e5 ? prevAll.filter((p) => p.asOf.getTime() === prevDate) : [];
    const agg = new Map<string, SelfFundedRow>();
    for (const r of cur) {
      const g = group(r.payer);
      const a = agg.get(g.key) ?? { ...g, members: 0, share: 0, prevMembers: null };
      a.members += r.members;
      agg.set(g.key, a);
    }
    for (const r of prev) { const a = agg.get(group(r.payer).key); if (a) a.prevMembers = (a.prevMembers ?? 0) + r.members; }
    const total = [...agg.values()].reduce((s, a) => s + a.members, 0);
    out.push({
      state, source: latest.source, asOf: latest.asOf, estimated: cur.some((r) => r.estimated), total,
      rows: [...agg.values()].filter((a) => a.members >= 50).map((a) => ({ ...a, share: total ? a.members / total : 0 })).sort((a, b) => b.members - a.members),
    });
  }
  return out;
}

export const sourceLabel = (s: SelfFunded) => `${s.source === "ma_chia" ? "MA CHIA" : "NH Insurance Dept"}${s.estimated ? " (estimated)" : ""}, ${s.asOf.toISOString().slice(0, 7)}`;
