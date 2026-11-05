import type { Funding } from "@prisma/client";
import { db } from "../db";
import { issuerPatternFor } from "./queries";

type Comp = { id?: string; name: string; aliases: string[]; issuerPattern: string | null };

export const SOURCE_INFO: Record<string, { label: string; url: string }> = {
  ma_chia: { label: "MA CHIA Enrollment Trends", url: "https://www.chiamass.gov/insights-analysis/access/enrollment-in-health-insurance/" },
  nh_nhid: { label: "NH Insurance Dept. cost drivers report (estimated from published shares)", url: "https://mm.nh.gov/files/uploads/nhid/documents/nhid-annualhearing-report-2023.pdf" },
  me_boi: { label: "Maine Bureau of Insurance financial results", url: "https://www.maine.gov/pfr/insurance/sites/maine.gov.pfr.insurance/files/inline-files/2025%20Financial%20Results%20for%20Health%20Insurance%20Companies%20in%20Maine%20-%20Detail%20Tables.pdf" },
  ri_ohic: { label: "RI OHIC large group rate review", url: "https://ohic.ri.gov/regulatory-review/rate-review" },
};

const re = (p: string) => { try { return new RegExp(p, "i"); } catch { return null; } };

// ─── competitor view ─────────────────────────────────────────────────

export type EnrollmentPoint = { asOf: Date; fully: number; self: number };
export type EnrollmentBlock = {
  source: string; state: string; estimated: boolean; series: EnrollmentPoint[];
  latest: EnrollmentPoint; yearAgo: EnrollmentPoint | null; marketTotal: number; bySector: Array<{ sector: string; fully: number; self: number }>;
  payers: string[]; notes: string[];
};

/** Large-group membership incl. self-insured, per state source, for one competitor. */
export async function competitorLargeGroup(c: Comp, state?: string) {
  const pattern = issuerPatternFor(c);
  const st = state && /^[A-Z]{2}$/.test(state) ? state : undefined;

  const rows = await db.$queryRaw<Array<{ source: string; state: string; asOf: Date; payer: string; funding: Funding; sector: string; members: number; estimated: boolean; note: string | null }>>`
    SELECT source, state, "asOf", payer, funding, sector, members, estimated, note FROM "MarketEnrollment"
    WHERE segment = 'LARGE_GROUP' AND payer ~* ${pattern} AND (${st ?? null}::text IS NULL OR state = ${st ?? null})`;
  const totals = await db.marketEnrollment.groupBy({
    by: ["source", "state", "asOf"],
    where: { segment: "LARGE_GROUP", ...(st ? { state: st } : {}) },
    _sum: { members: true },
  });

  const blocks: EnrollmentBlock[] = [];
  for (const key of [...new Set(rows.map((r) => `${r.source}|${r.state}`))]) {
    const [source, s] = key.split("|");
    const mine = rows.filter((r) => r.source === source && r.state === s);
    const byDate = new Map<string, EnrollmentPoint>();
    for (const r of mine) {
      const k = r.asOf.toISOString();
      const p = byDate.get(k) ?? { asOf: r.asOf, fully: 0, self: 0 };
      if (r.funding === "SELF_INSURED") p.self += r.members; else p.fully += r.members;
      byDate.set(k, p);
    }
    const series = [...byDate.values()].sort((a, b) => a.asOf.getTime() - b.asOf.getTime());
    const latest = series[series.length - 1];
    const target = latest.asOf.getTime() - 365 * 864e5;
    const yearAgo = series.find((p) => Math.abs(p.asOf.getTime() - target) < 45 * 864e5) ?? null;
    const sectors = new Map<string, { sector: string; fully: number; self: number }>();
    for (const r of mine.filter((r) => r.asOf.getTime() === latest.asOf.getTime())) {
      const x = sectors.get(r.sector) ?? { sector: r.sector, fully: 0, self: 0 };
      if (r.funding === "SELF_INSURED") x.self += r.members; else x.fully += r.members;
      sectors.set(r.sector, x);
    }
    blocks.push({
      source, state: s, estimated: mine.some((r) => r.estimated), series, latest, yearAgo,
      marketTotal: totals.find((t) => t.source === source && t.state === s && t.asOf.getTime() === latest.asOf.getTime())?._sum.members ?? 0,
      bySector: [...sectors.values()].sort((a, b) => b.fully + b.self - (a.fully + a.self)),
      payers: [...new Set(mine.map((r) => r.payer))],
      notes: [...new Set(mine.map((r) => r.note).filter(Boolean) as string[])],
    });
  }

  const finRows = await db.$queryRaw<Array<{ source: string; state: string; year: number; company: string; coveredLives: number | null; premium: number; claims: number; reserveChange: number | null; adminExpense: number | null; underwritingGain: number | null }>>`
    SELECT source, state, year, company, "coveredLives", premium, claims, "reserveChange", "adminExpense", "underwritingGain"
    FROM "StateFinancial" WHERE segment = 'LARGE_GROUP' AND NOT "isTotal" AND company ~* ${pattern}
      AND (${st ?? null}::text IS NULL OR state = ${st ?? null}) ORDER BY state, year`;
  const finTotals = await db.stateFinancial.findMany({ where: { isTotal: true, segment: "LARGE_GROUP", ...(st ? { state: st } : {}) } });
  const financials = finRows.map((r) => {
    const t = finTotals.find((x) => x.source === r.source && x.state === r.state && x.year === r.year);
    return { ...r, marketPremium: t?.premium ?? null, marketLives: t?.coveredLives ?? null };
  });

  const rateActions = await db.$queryRaw<Array<{ source: string; state: string; planYear: number; carrier: string; label: string; members: number | null; requested: number | null; approved: number | null; details: Record<string, number> | null }>>`
    SELECT source, state, "planYear", carrier, label, members, requested, approved, details FROM "GroupRateAction"
    WHERE segment = 'LARGE_GROUP' AND NOT "isTotal" AND carrier ~* ${pattern}
      AND (${st ?? null}::text IS NULL OR state = ${st ?? null}) ORDER BY state, "planYear" DESC`;
  const rateTotals = await db.groupRateAction.findMany({ where: { isTotal: true, segment: "LARGE_GROUP", ...(st ? { state: st } : {}) } });

  return {
    enrollment: blocks.sort((a, b) => a.state.localeCompare(b.state)),
    financials,
    rateActions: rateActions.map((a) => ({ ...a, market: rateTotals.find((t) => t.source === a.source && t.state === a.state && t.planYear === a.planYear) ?? null })),
  };
}

// ─── market view ─────────────────────────────────────────────────────

/** Large-group membership incl. self-insured for a state, grouped by the workspace's competitors. */
export async function marketLargeGroup(workspaceId: string, state: string) {
  const competitors = await db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } });
  const matchers = competitors.map((c) => ({ c, r: re(issuerPatternFor(c)) }));
  const group = (name: string) => {
    const m = matchers.find((x) => x.r?.test(name));
    return m ? { key: m.c.id, label: m.c.name, competitorId: m.c.id as string | null } : { key: `p:${name}`, label: name, competitorId: null };
  };

  // Enrollment (prefer MA CHIA style quarterly; NH annual estimates)
  const latestRow = await db.marketEnrollment.findFirst({ where: { state, segment: "LARGE_GROUP" }, orderBy: { asOf: "desc" } });
  let enrollment: null | {
    source: string; asOf: Date; estimated: boolean; total: number; totalSelf: number;
    rows: Array<{ key: string; label: string; competitorId: string | null; fully: number; self: number; total: number; share: number; selfShare: number; yoy: number | null }>;
  } = null;
  if (latestRow) {
    const [cur, prevAll] = await Promise.all([
      db.marketEnrollment.findMany({ where: { state, segment: "LARGE_GROUP", source: latestRow.source, asOf: latestRow.asOf } }),
      db.marketEnrollment.findMany({ where: { state, segment: "LARGE_GROUP", source: latestRow.source, asOf: { lt: latestRow.asOf } } }),
    ]);
    const target = latestRow.asOf.getTime() - 365 * 864e5;
    const prevDate = [...new Set(prevAll.map((p) => p.asOf.getTime()))].sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
    const prev = prevDate && Math.abs(prevDate - target) < 45 * 864e5 ? prevAll.filter((p) => p.asOf.getTime() === prevDate) : [];
    const agg = new Map<string, { key: string; label: string; competitorId: string | null; fully: number; self: number; prev: number }>();
    for (const r of cur) {
      const g = group(r.payer);
      const a = agg.get(g.key) ?? { ...g, fully: 0, self: 0, prev: 0 };
      if (r.funding === "SELF_INSURED") a.self += r.members; else a.fully += r.members;
      agg.set(g.key, a);
    }
    for (const r of prev) {
      const g = group(r.payer);
      const a = agg.get(g.key);
      if (a) a.prev += r.members;
    }
    const total = [...agg.values()].reduce((s, a) => s + a.fully + a.self, 0);
    enrollment = {
      source: latestRow.source, asOf: latestRow.asOf, estimated: cur.some((r) => r.estimated), total,
      totalSelf: [...agg.values()].reduce((s, a) => s + a.self, 0),
      rows: [...agg.values()].map((a) => {
        const t = a.fully + a.self;
        return { key: a.key, label: a.label, competitorId: a.competitorId, fully: a.fully, self: a.self, total: t, share: total ? t / total : 0, selfShare: t ? a.self / t : 0, yoy: a.prev ? t / a.prev - 1 : null };
      }).sort((a, b) => b.total - a.total),
    };
  }

  // State-published financials (ME): latest year by carrier
  const finYear = (await db.stateFinancial.findFirst({ where: { state, segment: "LARGE_GROUP" }, orderBy: { year: "desc" } }))?.year;
  const financials = finYear
    ? await (async () => {
        const [cur, prev] = await Promise.all([
          db.stateFinancial.findMany({ where: { state, segment: "LARGE_GROUP", year: finYear } }),
          db.stateFinancial.findMany({ where: { state, segment: "LARGE_GROUP", year: finYear - 1 } }),
        ]);
        return {
          year: finYear,
          source: cur[0]?.source,
          total: cur.find((r) => r.isTotal) ?? null,
          rows: cur.filter((r) => !r.isTotal).map((r) => ({ ...r, ...group(r.company), prior: prev.find((p) => p.company === r.company) ?? null })).sort((a, b) => b.premium - a.premium),
        };
      })()
    : null;

  // Regulator rate actions (RI): latest two plan years
  const ra = await db.groupRateAction.findMany({ where: { state, segment: "LARGE_GROUP" }, orderBy: [{ planYear: "desc" }, { members: "desc" }] });
  const years = [...new Set(ra.map((r) => r.planYear))].slice(0, 2);
  const rateActions = years.length
    ? years.map((y) => ({
        planYear: y,
        source: ra[0].source,
        total: ra.find((r) => r.planYear === y && r.isTotal) ?? null,
        rows: ra.filter((r) => r.planYear === y && !r.isTotal).map((r) => ({ ...r, ...group(r.carrier) })),
      }))
    : [];

  return { enrollment, financials, rateActions };
}
