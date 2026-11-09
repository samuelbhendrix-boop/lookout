import { db } from "../db";

/**
 * Self-funded (ASO) administration from Form 5500 Schedule C: who administers each employer's medical claims and what
 * the plan paid them. Fee per participant per month = direct compensation ÷ participants ÷ 12, latest filing per plan.
 * Schedule C covers only plans that pay providers from plan assets ($5,000+), so it's a sample of each carrier's book.
 */
export type AsoAccount = { planId: string; ein: string; planNum: string; sponsor: string; city: string | null; state: string; participants: number | null; year: number; admin: string; name: string; fee: number | null; pepm: number | null; brokers: string[] };

let cache: { at: number; value: Promise<AsoAccount[]> } | null = null;
export async function asoAccounts(): Promise<AsoAccount[]> {
  if (!cache || Date.now() - cache.at > 15 * 60_000) cache = { at: Date.now(), value: load() };
  return cache.value;
}

async function load(): Promise<AsoAccount[]> {
  const rows = await db.$queryRaw<Array<{ planId: string; ein: string; planNum: string; sponsor: string; city: string | null; state: string; participants: number | null; planYearBegin: Date; carrier: string; name: string; fee: number | null; brokers: string[] | null }>>`
    WITH latest AS (
      SELECT DISTINCT ON (p.ein, p."planNum") p.id, p.ein, p."planNum", p.sponsor, p.city, p.state, p.participants, p."planYearBegin"
      FROM "EmployerPlan" p WHERE EXISTS (SELECT 1 FROM "EmployerProvider" e WHERE e."planId" = p.id AND e.role = 'administrator' AND e.carrier IS NOT NULL)
      ORDER BY p.ein, p."planNum", p."planYearBegin" DESC)
    SELECT l.id "planId", l.ein, l."planNum", l.sponsor, l.city, l.state, l.participants, l."planYearBegin",
      a.carrier, a.name, a.fee,
      (SELECT array_agg(DISTINCT b.name) FROM "EmployerProvider" b WHERE b."planId" = l.id AND b.role = 'broker') brokers
    FROM latest l
    JOIN LATERAL (SELECT carrier, max(name) name, sum("directComp") fee FROM "EmployerProvider" e
                  WHERE e."planId" = l.id AND e.role = 'administrator' AND e.carrier IS NOT NULL GROUP BY carrier ORDER BY sum("directComp") DESC NULLS LAST LIMIT 1) a ON true`;
  return rows.map((r) => ({
    planId: r.planId, ein: r.ein, planNum: r.planNum, sponsor: r.sponsor, city: r.city, state: r.state, participants: r.participants, year: r.planYearBegin.getUTCFullYear(),
    admin: r.carrier, name: r.name, fee: r.fee,
    // Below $1 or above $250 per participant per month is a partial-year or mis-keyed amount, not a fee level.
    pepm: r.fee && r.participants && r.participants >= 50 ? (r.fee / r.participants / 12 >= 1 && r.fee / r.participants / 12 <= 250 ? r.fee / r.participants / 12 : null) : null,
    brokers: r.brokers ?? [],
  }));
}

const q = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * p; return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i)); };

/** Per administrator: accounts, people, and the fee distribution (per participant per month). */
export async function asoBenchmarks(state?: string) {
  const all = (await asoAccounts()).filter((a) => !state || a.state === state);
  const by = new Map<string, AsoAccount[]>();
  for (const a of all) (by.get(a.admin) ?? by.set(a.admin, []).get(a.admin)!).push(a);
  return [...by.entries()].map(([admin, xs]) => {
    const fees = xs.map((x) => x.pepm).filter((x): x is number => x != null);
    return { admin, accounts: xs.length, participants: xs.reduce((s, x) => s + (x.participants ?? 0), 0), withFee: fees.length, p25: q(fees, 0.25), median: q(fees, 0.5), p75: q(fees, 0.75) };
  }).sort((a, b) => b.accounts - a.accounts);
}
