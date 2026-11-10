import kff from "@/data/benchmarks/kff-coverage.json";
import { db } from "../db";
import { NE_STATES } from "./products";
import { fehbEstimate } from "./fehb";

/**
 * How much of each state's commercial market the app's numbers capture, checked against an independent count:
 * KFF's state coverage totals (Census ACS, people by their main coverage, by where they live).
 *  - Individual: CMS loss-ratio filings count every fully insured individual policy, on and off exchange,
 *    grandfathered included, so they should land close to KFF's non-group count.
 *  - Employer: loss-ratio filings cover fully insured group only. Self-funded (ASO) employers are added where the
 *    state publishes them (MA CHIA) or from the CMS filings elsewhere, plus an estimate of federal employees (FEHB).
 *    The rest of KFF's employer count is what the app can't see: independent administrators, level-funded and
 *    association plans, and residents covered by contracts written in another state.
 * Massachusetts uses CHIA for both fully and self-insured group, because the federal filing counts some BCBSMA
 * accounts as fully insured that CHIA counts as self-insured; adding the two sources would double count them.
 */
type K = { employer: number; nonGroup: number; total: number };
const KFF = kff as unknown as { source: string; url: string; year: number; checked: string; states: Record<string, K> };

export type CoverageRow = {
  state: string;
  individual: number; kffNonGroup: number; individualCapture: number;
  fullyInsuredGroup: number; selfFunded: number | null; selfSource: string | null; selfEstimated: number; residentBasis: boolean; federal: number; groupSeen: number; kffEmployer: number; employerCapture: number; unseen: number;
};

export async function coverageCheck(): Promise<{ year: number | null; kff: { source: string; url: string; year: number }; rows: CoverageRow[] }> {
  const year = (await db.marketFinancial.aggregate({ where: { state: { in: NE_STATES } }, _max: { year: true } }))._max.year;
  if (!year) return { year: null, kff: KFF, rows: [] };
  const mlr = await db.marketFinancial.groupBy({ by: ["state", "segment"], where: { year, state: { in: NE_STATES } }, _sum: { coveredLives: true } });
  const lives = (st: string, seg: string) => mlr.find((m) => m.state === st && m.segment === seg)?._sum.coveredLives ?? 0;
  const rows: CoverageRow[] = [];
  for (const st of NE_STATES) {
    const k = KFF.states[st];
    if (!k) continue;
    const self = st === "MA" ? await db.marketEnrollment.findFirst({ where: { state: st, funding: "SELF_INSURED" }, orderBy: { asOf: "desc" } }) : null;
    let selfFunded: number | null = null, selfSource: string | null = null, fullyGroup = lives(st, "SMALL_GROUP") + lives(st, "LARGE_GROUP");
    let selfEstimated = 0;
    if (!self) {
      // Federal filings: self-funded lives by the state the contract is written in, some carriers estimated.
      const yr = (await db.selfFundedLives.aggregate({ where: { state: st }, _max: { year: true } }))._max.year;
      if (yr) {
        const sf = await db.selfFundedLives.findMany({ where: { state: st, year: yr }, select: { lives: true, basis: true } });
        selfFunded = sf.reduce((s, r) => s + r.lives, 0);
        selfEstimated = sf.filter((r) => r.basis !== "reported").reduce((s, r) => s + r.lives, 0);
        selfSource = `CMS loss-ratio filings ${yr}, contract state${selfEstimated ? `; ${Math.round((selfEstimated / (selfFunded || 1)) * 100)}% estimated` : ""}`;
      }
    }
    if (self) {
      const at = await db.marketEnrollment.findMany({ where: { state: st, source: self.source, asOf: self.asOf }, select: { funding: true, segment: true, members: true } });
      selfFunded = at.filter((r) => r.funding === "SELF_INSURED").reduce((s, r) => s + r.members, 0);
      selfSource = `${self.source === "ma_chia" ? "MA CHIA" : "NH Insurance Dept"}${self.estimated ? " (estimate)" : ""}, ${self.asOf.toISOString().slice(0, 7)}`;
      // Same source for fully insured group where it has it (MA), so the two halves don't overlap.
      const fiGroup = at.filter((r) => r.funding === "FULLY_INSURED" && r.segment !== "INDIVIDUAL").reduce((s, r) => s + r.members, 0);
      if (self.source === "ma_chia" && fiGroup > 0) fullyGroup = fiGroup;
    }
    const individual = lives(st, "INDIVIDUAL");
    // Federal employees (estimate). In MA, BCBSMA already reports its federal members to CHIA, so add only the rest.
    const fe = fehbEstimate(st);
    const federal = fe ? (fe.inChia ? fe.other : fe.total) : 0;
    const groupSeen = fullyGroup + (selfFunded ?? 0) + federal;
    rows.push({
      state: st, individual, kffNonGroup: k.nonGroup, individualCapture: individual / k.nonGroup,
      fullyInsuredGroup: fullyGroup, selfFunded, selfSource, selfEstimated, residentBasis: !!self, federal, groupSeen, kffEmployer: k.employer, employerCapture: groupSeen / k.employer, unseen: Math.max(0, k.employer - groupSeen),
    });
  }
  return { year, kff: KFF, rows };
}
