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
export const SELF_FUNDED_STATES = ["MA", "CT", "RI", "NH", "VT", "ME"];

export type SelfFundedRow = { key: string; label: string; competitorId: string | null; members: number; share: number; prevMembers: number | null; basis?: string[]; feePmpm?: number | null; notes?: string[] };
export type SelfFunded = { state: string; source: string; asOf: Date; estimated: boolean; total: number; rows: SelfFundedRow[] };
/** How a federal-filing figure was arrived at, in plain words. */
export const BASIS: Record<string, string> = { reported: "filed", allocated: "estimated from a national total filed under one state", disclosed: "estimated from the carrier's national disclosure" };

const re = (p: string) => { try { return p ? new RegExp(p, "i") : null; } catch { return null; } };

/** Self-funded membership by competitor for each state that publishes it (latest report, with the one a year earlier). */
export async function selfFunded(workspaceId: string, states = SELF_FUNDED_STATES): Promise<SelfFunded[]> {
  const comps = await db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } });
  const matchers = comps.map((c) => ({ c, r: re(issuerPatternFor(c)) }));
  const group = (payer: string) => { const m = matchers.find((x) => x.r?.test(payer)); return m ? { key: m.c.id, label: m.c.name, competitorId: m.c.id as string | null } : { key: `p:${payer}`, label: payer, competitorId: null }; };
  const out: SelfFunded[] = [];
  for (const state of states) {
    // Massachusetts: CHIA's actual resident counts. Elsewhere: the federal loss-ratio filings ("uninsured plans"),
    // by the state the contract is written in, with estimates for carriers that don't file by state.
    if (state !== "MA") {
      const yr = (await db.selfFundedLives.aggregate({ where: { state }, _max: { year: true } }))._max.year;
      if (yr) {
        const [cur, prev] = await Promise.all([db.selfFundedLives.findMany({ where: { state, year: yr } }), db.selfFundedLives.findMany({ where: { state, year: yr - 1 } })]);
        const agg = new Map<string, SelfFundedRow & { mm: number; fees: number }>();
        for (const r of cur) {
          const g = group(r.company);
          const a = agg.get(g.key) ?? { ...g, members: 0, share: 0, prevMembers: null, basis: [], notes: [], mm: 0, fees: 0 };
          a.members += r.lives;
          if (!a.basis!.includes(r.basis)) a.basis!.push(r.basis);
          if (r.note) a.notes!.push(r.note);
          if (r.fees && r.memberMonths) { a.fees += r.fees; a.mm += r.memberMonths; }
          agg.set(g.key, a);
        }
        for (const r of prev) { const a = agg.get(group(r.company).key); if (a) a.prevMembers = (a.prevMembers ?? 0) + r.lives; }
        const total = [...agg.values()].reduce((t, a) => t + a.members, 0);
        out.push({
          state, source: "cms_mlr", asOf: new Date(Date.UTC(yr, 11, 31)), estimated: cur.some((r) => r.basis !== "reported"), total,
          rows: [...agg.values()].filter((a) => a.members >= 50).map(({ mm, fees, ...a }) => ({ ...a, share: total ? a.members / total : 0, feePmpm: mm > 0 ? fees / mm : null })).sort((a, b) => b.members - a.members),
        });
        continue;
      }
    }
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

export const sourceLabel = (s: SelfFunded) => s.source === "cms_mlr"
  ? `CMS loss-ratio filings ${s.asOf.getUTCFullYear()}, by the state the contract is written in${s.estimated ? " (some carriers estimated)" : ""}`
  : `${s.source === "ma_chia" ? "MA CHIA, residents" : "NH Insurance Dept"}${s.estimated ? " (estimated)" : ""}, ${s.asOf.toISOString().slice(0, 7)}`;

/** Massachusetts is the one state with actual counts (CHIA): how the federal figures and estimates compare there. */
export async function asoMethodCheck(workspaceId: string) {
  const yr = (await db.selfFundedLives.aggregate({ where: { state: "MA" }, _max: { year: true } }))._max.year;
  const chia = (await selfFunded(workspaceId, ["MA"]))[0];
  if (!yr || !chia) return null;
  const comps = await db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } });
  const matchers = comps.map((c) => ({ c, r: re(issuerPatternFor(c)) }));
  const fed = new Map<string, { label: string; lives: number; basis: Set<string> }>();
  for (const r of await db.selfFundedLives.findMany({ where: { state: "MA", year: yr } })) {
    const m = matchers.find((x) => x.r?.test(r.company));
    const k = m?.c.id ?? `p:${r.company}`;
    const a = fed.get(k) ?? fed.set(k, { label: m?.c.name ?? r.company, lives: 0, basis: new Set() }).get(k)!;
    a.lives += r.lives; a.basis.add(r.basis);
  }
  return { year: yr, chiaAsOf: chia.asOf, rows: [...fed.entries()].map(([k, f]) => ({ label: f.label, federal: f.lives, basis: [...f.basis], chia: chia.rows.find((r) => (r.competitorId ?? r.key) === k)?.members ?? null })).sort((a, b) => b.federal - a.federal) };
}
