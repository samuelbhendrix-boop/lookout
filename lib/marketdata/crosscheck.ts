import type { Segment } from "@prisma/client";
import { db } from "../db";

/**
 * Cross-checks the fully insured market size from CMS loss-ratio (MLR) filings against an independent count for the
 * same state and segment:
 *  - MA (all segments): CHIA enrollment, fully insured, the report closest to Dec of the MLR year
 *  - ME large group: Bureau of Insurance financial results, covered lives
 *  - NH large group: Insurance Department report (estimated from published shares)
 *  - RI large group: OHIC rate review, members at filing
 *  - Individual & small group, every state: carriers' ACA rate filings (URRT), enrollment reported at filing — a
 *    different form filed to a different deadline, so it moves with the market but runs earlier in the year
 * Differences are expected (timing, entity scope, self-insured mislabels); the point is order of magnitude.
 */
export type Check = { state: string; segment: Segment; year: number; mlr: number; mlrAvg: number; source: string; period: string; value: number; diff: number };

const NE = ["MA", "CT", "RI", "NH", "VT", "ME"];

export async function crossCheck(year: number): Promise<Check[]> {
  const mlr = await db.marketFinancial.groupBy({ by: ["state", "segment"], where: { year, state: { in: NE } }, _sum: { coveredLives: true, memberMonths: true } });
  const get = (s: string, seg: Segment) => mlr.find((m) => m.state === s && m.segment === seg)?._sum;
  const out: Check[] = [];
  const push = (state: string, segment: Segment, source: string, period: string, value: number) => {
    const m = get(state, segment);
    if (!m?.coveredLives || !value) return;
    out.push({ state, segment, year, mlr: m.coveredLives, mlrAvg: (m.memberMonths ?? 0) / 12, source, period, value, diff: m.coveredLives / value - 1 });
  };

  // MA CHIA: the report date nearest Dec 31 of the MLR year.
  const asOfs = (await db.marketEnrollment.findMany({ where: { source: "ma_chia" }, select: { asOf: true }, distinct: ["asOf"] })).map((r) => r.asOf);
  const target = Date.UTC(year, 11, 31);
  const chiaAt = asOfs.sort((a, b) => Math.abs(a.getTime() - target) - Math.abs(b.getTime() - target))[0];
  if (chiaAt) {
    const chia = await db.marketEnrollment.groupBy({ by: ["segment"], where: { source: "ma_chia", asOf: chiaAt, funding: "FULLY_INSURED" }, _sum: { members: true } });
    for (const c of chia) push("MA", c.segment, "MA CHIA enrollment (fully insured)", chiaAt.toISOString().slice(0, 7), c._sum.members ?? 0);
  }
  // ME BOI large group.
  const me = await db.stateFinancial.aggregate({ where: { source: "me_boi", state: "ME", segment: "LARGE_GROUP", year, isTotal: false }, _sum: { coveredLives: true } });
  if (me._sum.coveredLives) push("ME", "LARGE_GROUP", "Maine Bureau of Insurance", String(year), me._sum.coveredLives);
  // NH large group (one report year).
  const nhAt = (await db.marketEnrollment.aggregate({ where: { source: "nh_nhid", segment: "LARGE_GROUP" }, _max: { asOf: true } }))._max.asOf;
  if (nhAt && Math.abs(nhAt.getUTCFullYear() - year) <= 0) {
    const nh = await db.marketEnrollment.aggregate({ where: { source: "nh_nhid", segment: "LARGE_GROUP", asOf: nhAt, funding: "FULLY_INSURED" }, _sum: { members: true } });
    push("NH", "LARGE_GROUP", "NH Insurance Dept report (estimated)", nhAt.toISOString().slice(0, 7), nh._sum.members ?? 0);
  }
  // RI OHIC large group: rate review for plan year year+2 reports members around the MLR year's end.
  const ri = await db.groupRateAction.findMany({ where: { source: "ri_ohic", segment: "LARGE_GROUP", isTotal: false }, select: { planYear: true, members: true } });
  const riYear = [...new Set(ri.map((r) => r.planYear))].sort((a, b) => Math.abs(a - (year + 2)) - Math.abs(b - (year + 2)))[0];
  if (riYear) push("RI", "LARGE_GROUP", "RI OHIC rate review (members at filing)", `PY${riYear} filing`, ri.filter((r) => r.planYear === riYear).reduce((s, r) => s + (r.members ?? 0), 0));
  // URRT enrollment for the plan year filed in (year+1): enrollment as of the experience period ≈ the MLR year.
  const urrt = await db.$queryRaw<Array<{ state: string; market: string; e: number }>>`
    WITH latest AS (SELECT DISTINCT ON ("planId") state, market, enrollment FROM "RatePlan" WHERE "planYear" = ${year + 1} AND state = ANY(${NE}) ORDER BY "planId", "effectiveDate" DESC)
    SELECT state, market, SUM(enrollment)::float e FROM latest GROUP BY state, market`;
  for (const u of urrt) {
    const seg: Segment | null = /individual/i.test(u.market) ? "INDIVIDUAL" : /small/i.test(u.market) ? "SMALL_GROUP" : null;
    if (seg && !(u.state === "MA" && out.some((o) => o.state === "MA" && o.segment === seg))) push(u.state, seg, "ACA rate filings (URRT enrollment)", `PY${year + 1} filing`, u.e);
  }
  return out.sort((a, b) => NE.indexOf(a.state) - NE.indexOf(b.state) || a.segment.localeCompare(b.segment));
}
