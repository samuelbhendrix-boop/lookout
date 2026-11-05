import { db } from "../db";
import { issuerPatternFor } from "./queries";

/** NAICS 2-digit sector names (BUSINESS_CODE on Form 5500 is a 6-digit NAICS code). */
const NAICS: Record<string, string> = {
  "11": "Agriculture", "21": "Mining & energy", "22": "Utilities", "23": "Construction", "31": "Manufacturing", "32": "Manufacturing",
  "33": "Manufacturing", "42": "Wholesale", "44": "Retail", "45": "Retail", "48": "Transportation", "49": "Transportation",
  "51": "Information & media", "52": "Finance & insurance", "53": "Real estate", "54": "Professional services", "55": "Holding companies",
  "56": "Admin & support", "61": "Education", "62": "Health care", "71": "Arts & recreation", "72": "Hospitality", "81": "Other services", "92": "Public administration",
};
export const sectorOf = (naics: string | null) => (naics ? NAICS[naics.slice(0, 2)] ?? "Other" : "Unknown");

export type EmployerRow = {
  id: string; ein: string; sponsor: string; city: string | null; state: string; naics: string | null; sector: string;
  participants: number | null; planYearBegin: Date; funding: string; tiCarrier?: string | null;
  carriers: Array<{ carrier: string; competitorId: string | null; competitorName: string | null; persons: number | null; premium: number | null; renewalMonth: number | null; brokers: string[] }>;
  stopLoss: string[];
};

type Filters = { state?: string; competitorId?: string; funding?: string; minParticipants?: number; q?: string; limit?: number };

/** Latest Form 5500 filing per employer plan, with its health carriers and brokers mapped to competitors. */
export async function listEmployers(workspaceId: string, f: Filters) {
  const competitors = await db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } });
  const matchers = competitors.map((c) => ({ c, re: safe(issuerPatternFor(c)) }));
  const target = f.competitorId ? competitors.find((c) => c.id === f.competitorId) : undefined;
  const pattern = target ? issuerPatternFor(target) : null;
  const st = f.state && /^[A-Z]{2}$/.test(f.state) ? f.state : null;
  const q = f.q?.trim() ? `%${f.q.trim()}%` : null;
  const funding = f.funding && ["insured", "self-funded", "mixed"].includes(f.funding) ? f.funding : null;
  const limit = Math.min(f.limit ?? 200, 2000);

  const base = await db.$queryRaw<Array<{ id: string; ein: string; sponsor: string; city: string | null; state: string; naics: string | null; participants: number | null; planYearBegin: Date; funding: string }>>`
    WITH latest AS (
      SELECT DISTINCT ON (ein, "planNum") * FROM "EmployerPlan"
      ORDER BY ein, "planNum", "planYearBegin" DESC, "receivedAt" DESC NULLS LAST
    )
    SELECT id, ein, sponsor, city, state, naics, participants, "planYearBegin", funding FROM latest l
    WHERE (${st}::text IS NULL OR l.state = ${st})
      AND (${funding}::text IS NULL OR l.funding = ${funding})
      AND (${q}::text IS NULL OR l.sponsor ILIKE ${q} OR l."planName" ILIKE ${q})
      AND COALESCE(l.participants, 0) >= ${f.minParticipants ?? 0}
      AND (${pattern}::text IS NULL OR EXISTS (
        SELECT 1 FROM "EmployerContract" c WHERE c."planId" = l.id AND c.kind = 'health' AND c.carrier ~* ${pattern}))
    ORDER BY l.participants DESC NULLS LAST
    LIMIT ${limit}`;

  const contracts = await db.employerContract.findMany({ where: { planId: { in: base.map((b) => b.id) } } });
  const rows: EmployerRow[] = base.map((b) => {
    const mine = contracts.filter((c) => c.planId === b.id);
    return {
      ...b,
      sector: sectorOf(b.naics),
      carriers: mine.filter((c) => c.kind === "health").map((c) => {
        const m = matchers.find((x) => x.re?.test(c.carrier));
        return {
          carrier: c.carrier, competitorId: m?.c.id ?? null, competitorName: m?.c.name ?? null,
          persons: c.personsCovered, premium: c.premium, renewalMonth: c.policyFrom ? c.policyFrom.getUTCMonth() + 1 : null,
          brokers: ((c.brokers as Array<{ name: string }> | null) ?? []).map((x) => x.name),
        };
      }),
      stopLoss: mine.filter((c) => c.kind === "stop_loss").map((c) => c.carrier),
    };
  });
  return rows;
}

/** A competitor's employer book from Form 5500: totals, top employers, brokers, renewal timing. */
export async function competitorEmployers(workspaceId: string, competitorId: string, state?: string) {
  const rows = await listEmployers(workspaceId, { competitorId, state, limit: 2000 });
  const mine = rows.map((r) => ({ ...r, c: r.carriers.filter((c) => c.competitorId === competitorId) }));
  const persons = mine.reduce((s, r) => s + r.c.reduce((t, c) => t + (c.persons ?? 0), 0), 0);
  const insured = mine.filter((r) => r.c.some((c) => (c.premium ?? 0) > 0)).length;
  const brokerMap = new Map<string, { name: string; employers: number; persons: number }>();
  const months = Array(12).fill(0) as number[];
  const sectors = new Map<string, number>();
  for (const r of mine) {
    sectors.set(r.sector, (sectors.get(r.sector) ?? 0) + 1);
    for (const c of r.c) {
      if (c.renewalMonth) months[c.renewalMonth - 1]++;
      for (const b of new Set(c.brokers)) {
        const x = brokerMap.get(b) ?? { name: b, employers: 0, persons: 0 };
        x.employers++;
        x.persons += c.persons ?? 0;
        brokerMap.set(b, x);
      }
    }
  }
  return {
    employers: mine.length,
    persons,
    insured,
    asoOrUnpriced: mine.length - insured,
    top: mine.slice(0, 15),
    brokers: [...brokerMap.values()].sort((a, b) => b.employers - a.employers).slice(0, 10),
    renewalMonths: months,
    sectors: [...sectors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
  };
}

function safe(p: string) {
  try {
    return p ? new RegExp(p, "i") : null;
  } catch {
    return null;
  }
}
