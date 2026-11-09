import { db } from "../db";
import { CURATED_ISSUER_PATTERNS } from "../starter-packs";
import { ingestSignal } from "../signals";
import { issuerPatternFor } from "./queries";

/**
 * Market change detection. Detectors compare the latest data with the previous period and write MarketEvents
 * (idempotent by eventKey); syncEventsToWorkspaces() turns them into Signals for workspaces tracking that carrier,
 * so the feed, alert rules and weekly digests pick them up like any other intel.
 */
export type EventInput = {
  eventKey: string; kind: string; carrier: string; title: string; summary: string; url?: string; importance?: number;
  state?: string | null; data?: object; occurredAt: Date;
};

export async function writeEvents(events: EventInput[]) {
  let n = 0;
  for (let i = 0; i < events.length; i += 500) {
    const r = await db.marketEvent.createMany({ data: events.slice(i, i + 500).map((e) => ({ ...e, importance: e.importance ?? 2, data: e.data ?? undefined })), skipDuplicates: true });
    n += r.count;
  }
  return n;
}

// ── Carrier identity ────────────────────────────────────────────────────────────────────────────

const EXTRA: Record<string, string> = {
  "Blue Cross and Blue Shield of Vermont": "blue cross.*vermont|bcbsvt",
  "Health New England": "health new england",
  "ConnectiCare": "connecticare",
  "MVP Health Care": "\\bmvp health",
  "Ambetter (Centene)": "ambetter|celtic insurance|granite state health plan",
  "Matthew Thornton Health Plan": "matthew thornton",
};
const IDENTITIES = Object.entries({ ...CURATED_ISSUER_PATTERNS, ...EXTRA }).map(([name, p]) => ({ name, re: new RegExp(p, "i") }));

/** Group legal-entity names ("CIGNA HEALTH AND LIFE INS CO", "Connecticut General Life") under one carrier. */
export function canonicalCarrier(text: string): string | null {
  return IDENTITIES.find((i) => i.re.test(text))?.name ?? null;
}

const fmtN = (n: number) => n.toLocaleString("en-US");
const pctTxt = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;

// ── Accounts won / lost (Form 5500) ──────────────────────────────────────────────────────────────

/**
 * For each employer plan with filings in consecutive plan years, compare the health carriers on Schedule A.
 * A carrier that appears is a win, one that disappears a loss; insured → self-funded is a loss for the insurer.
 */
export async function detectAccountChanges(): Promise<EventInput[]> {
  const plans = await db.employerPlan.findMany({
    where: { planYearBegin: { gte: new Date("2019-01-01") } },
    select: { id: true, ein: true, planNum: true, sponsor: true, state: true, city: true, participants: true, planYearBegin: true, funding: true },
    orderBy: { planYearBegin: "asc" },
  });
  const contracts = await db.employerContract.findMany({ where: { kind: "health" }, select: { planId: true, carrier: true, personsCovered: true, brokers: true } });
  const byPlan = new Map<string, typeof contracts>();
  for (const c of contracts) (byPlan.get(c.planId) ?? byPlan.set(c.planId, []).get(c.planId)!).push(c);

  const series = new Map<string, typeof plans>();
  for (const p of plans) (series.get(`${p.ein}|${p.planNum}`) ?? series.set(`${p.ein}|${p.planNum}`, []).get(`${p.ein}|${p.planNum}`)!).push(p);

  const out: EventInput[] = [];
  for (const list of series.values()) {
    // One filing per plan year (latest wins).
    const perYear = new Map<number, (typeof plans)[number]>();
    for (const p of list) perYear.set(p.planYearBegin.getUTCFullYear(), p);
    const years = [...perYear.keys()].sort();
    for (let i = 1; i < years.length; i++) {
      if (years[i] - years[i - 1] !== 1) continue;
      const prev = perYear.get(years[i - 1])!, next = perYear.get(years[i])!;
      const carriersOf = (p: typeof prev) => {
        const m = new Map<string, { persons: number; brokers: string[] }>();
        for (const c of byPlan.get(p.id) ?? []) {
          const k = canonicalCarrier(c.carrier);
          if (!k) continue;
          const x = m.get(k) ?? { persons: 0, brokers: [] };
          x.persons += c.personsCovered ?? 0;
          for (const b of (c.brokers as Array<{ name: string }> | null) ?? []) if (!x.brokers.includes(b.name)) x.brokers.push(b.name);
          m.set(k, x);
        }
        return m;
      };
      const a = carriersOf(prev), b = carriersOf(next);
      const wentSelfFunded = !b.size && next.funding === "self-funded" && prev.funding !== "self-funded";
      if (!a.size && !b.size) continue;
      if (a.size && !b.size && !wentSelfFunded) continue; // incomplete filing, not a change
      const who = `${next.sponsor}${next.city ? ` (${next.city}, ${next.state})` : ` (${next.state})`}`;
      const size = next.participants ?? prev.participants ?? 0;
      const impFor = (persons: number) => { const n = persons || 0; return n >= 1000 ? 4 : n >= 250 ? 3 : 2; };
      const url = `/employers?q=${encodeURIComponent(next.sponsor)}`;
      // Material changes only: a carrier covering ≥50 people and ≥20% of participants. A 150-person insured add-on to a
      // 10,000-person self-funded plan is not an account switch. Unknown coverage counts, at low importance.
      const material = (x: { persons: number }) => !x.persons || (x.persons >= 50 && (!size || x.persons >= 0.2 * size));
      const lostTo = [...b.keys()].filter((k) => !a.has(k) && material(b.get(k)!));
      const lostFrom = [...a.keys()].filter((k) => !b.has(k) && material(a.get(k)!));
      for (const k of lostTo) {
        const x = b.get(k)!;
        out.push({
          eventKey: `acct:${next.ein}:${next.planNum}:${years[i]}:won:${k}`, kind: "account_won", carrier: k, state: next.state, importance: impFor(x.persons), url, occurredAt: next.planYearBegin,
          title: `${k} won ${who}${x.persons ? ` — ${fmtN(x.persons)} covered` : ""}${lostFrom.length ? `, from ${lostFrom.join(" & ")}` : ""}`,
          summary: `Form 5500 plan year ${years[i]}: ${k} is a health carrier for ${next.sponsor} (${fmtN(size)} participants${x.persons ? `, ${fmtN(x.persons)} covered` : ""}); it wasn't in ${years[i - 1]}.${x.brokers.length ? ` Broker: ${x.brokers.slice(0, 3).join(", ")}.` : ""}`,
          data: { ein: next.ein, participants: size, from: lostFrom, brokers: x.brokers },
        });
      }
      for (const k of lostFrom) {
        out.push({
          eventKey: `acct:${next.ein}:${next.planNum}:${years[i]}:lost:${k}`, kind: "account_lost", carrier: k, state: next.state, importance: impFor(a.get(k)!.persons), url, occurredAt: next.planYearBegin,
          title: `${k} lost ${who}${a.get(k)!.persons ? ` — ${fmtN(a.get(k)!.persons)} covered` : ""}${lostTo.length ? `, to ${lostTo.join(" & ")}` : wentSelfFunded ? ", moved to self-funding" : ""}`,
          summary: `Form 5500 plan year ${years[i]}: ${k} covered ${fmtN(a.get(k)!.persons || size)} at ${next.sponsor} in ${years[i - 1]} and is no longer listed.${wentSelfFunded ? " The plan now reports as self-funded; check the Employers page for its administrator." : ""}`,
          data: { ein: next.ein, participants: size, to: lostTo, selfFunded: wentSelfFunded },
        });
      }
    }
  }
  return out;
}

// ── ACA rate filings (URRT) ─────────────────────────────────────────────────────────────────────

/**
 * Each New England ACA filing's headline: the enrollment-weighted average rate change across its renewing plans (what
 * carriers file and regulators publish). Projected index rate PMPM = total projected index rate ÷ projected member months.
 */
export async function detectFilingChanges(): Promise<EventInput[]> {
  const { dolStates } = await import("./dol");
  const states = [...dolStates()];
  const filings = await db.rateFiling.findMany({
    where: { state: { in: states } },
    select: { id: true, planYear: true, state: true, company: true, market: true, effectiveDate: true, projIndexRate: true, projMemberMonths: true, serffNumber: true,
      plans: { select: { rateChange: true, enrollment: true, category: true } } },
  });
  const out: EventInput[] = [];
  for (const f of filings) {
    const renew = f.plans.filter((p) => p.category === "Renewing" && p.rateChange != null && (p.enrollment ?? 0) > 0);
    const enr = renew.reduce((t, p) => t + p.enrollment!, 0);
    if (!enr) continue;
    const ch = renew.reduce((t, p) => t + p.rateChange! * p.enrollment!, 0) / enr;
    const pmpm = f.projIndexRate && f.projMemberMonths ? f.projIndexRate / f.projMemberMonths : null;
    out.push({
      eventKey: `filing:${f.id}`, kind: "rate_filing", carrier: f.company, state: f.state, occurredAt: f.effectiveDate,
      importance: Math.abs(ch) >= 0.15 ? 4 : Math.abs(ch) >= 0.08 ? 3 : 2,
      url: `/market?state=${f.state}`,
      title: `${f.company} ${f.state} ${f.market.toLowerCase()} ${f.planYear}: average rate change ${pctTxt(ch)}`,
      summary: `ACA rate filing ${f.serffNumber ?? f.id}: enrollment-weighted average across ${renew.length} renewing plans (${fmtN(enr)} members)${pmpm && pmpm < 5000 ? `; projected index rate $${pmpm.toFixed(2)} PMPM` : ""}.`,
      data: { change: ch, enrollment: enr, pmpm },
    });
  }
  return out;
}

// ── Negotiated rates and networks (month over month) ────────────────────────────────────────────

const RATE_CHANGE_MIN = 0.05;

/**
 * Compares this month's carrier-level rates with last month's. One event per carrier × provider (not per code), and
 * hospital network adds/drops — but only for carriers whose coverage is comparable across the two months, so a
 * failed or partial import never masquerades as a network change.
 */
export async function detectRateChanges(month = currentMonth()): Promise<EventInput[]> {
  const prevMonth = shiftMonth(month, -1);
  // Everything is filtered in SQL: the two months together are ~250k rows, too many to hold in a 512 MB server's importer.
  const counts = await db.$queryRaw<Array<{ carrier: string; cur: bigint; prev: bigint }>>`
    SELECT carrier, count(*) FILTER (WHERE month = ${month}) cur, count(*) FILTER (WHERE month = ${prevMonth}) prev
    FROM "RateHistory" WHERE month IN (${month}, ${prevMonth}) GROUP BY carrier`;
  if (!counts.some((c) => Number(c.prev) > 0)) return []; // first month of history
  const rows = await db.$queryRaw<Array<{ carrier: string; carrierName: string; tin: string; codeType: string; code: string; billingClass: string; cur: number; prev: number }>>`
    SELECT c.carrier, c."carrierName", c.tin, c."codeType", c.code, c."billingClass", c.median cur, p.median prev
    FROM "RateHistory" c JOIN "RateHistory" p
      ON p.month = ${prevMonth} AND c.carrier = p.carrier AND c.tin = p.tin AND c."codeType" = p."codeType" AND c.code = p.code AND c."billingClass" = p."billingClass"
    WHERE c.month = ${month} AND p.median > 0 AND abs(c.median / p.median - 1) >= ${RATE_CHANGE_MIN} AND abs(c.median - p.median) >= 5`;
  // Hospitals (inpatient DRG prices) present in one month and not the other.
  const hospitals = await db.$queryRaw<Array<{ carrier: string; carrierName: string; tin: string; cur: boolean; prev: boolean }>>`
    SELECT carrier, max("carrierName") "carrierName", tin, bool_or(month = ${month}) cur, bool_or(month = ${prevMonth}) prev
    FROM "RateHistory" WHERE month IN (${month}, ${prevMonth}) AND "codeType" LIKE '%DRG'
    GROUP BY carrier, tin HAVING bool_or(month = ${month}) <> bool_or(month = ${prevMonth})`;

  const { irsName, providerState } = await import("./mrf/medicare");
  const { codeInfo } = await import("./mrf/queries");
  const byCarrier = new Map<string, typeof rows>();
  for (const r of rows) (byCarrier.get(r.carrier) ?? byCarrier.set(r.carrier, []).get(r.carrier)!).push(r);
  const out: EventInput[] = [];
  const when = new Date(`${month}-01T00:00:00Z`);
  for (const cnt of counts) {
    const carrier = cnt.carrier, list = byCarrier.get(carrier) ?? [];
    const cur = Number(cnt.cur), prev = Number(cnt.prev);
    if (!cur || !prev) continue; // carrier missing a month entirely: an import problem, not a change
    const comparable = Math.min(cur, prev) / Math.max(cur, prev) > 0.8;
    const mineH = hospitals.filter((h) => h.carrier === carrier);
    const name = list[0]?.carrierName ?? mineH[0]?.carrierName ?? carrier;
    // Rate changes, grouped per provider.
    const perTin = new Map<string, typeof list>();
    for (const r of list) (perTin.get(r.tin) ?? perTin.set(r.tin, []).get(r.tin)!).push(r);
    for (const [tin, ch] of perTin) {
      const sorted = ch.map((r) => ({ r, d: r.cur! / r.prev! - 1 })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
      const med = sorted.map((x) => x.d).sort((a, b) => a - b)[sorted.length >> 1];
      const top = sorted[0];
      const prov = irsName(tin) ?? `TIN ${tin}`;
      const label = (r: (typeof list)[number]) => codeInfo(r.codeType, r.code)?.label ?? `${r.codeType} ${r.code}`;
      out.push({
        eventKey: `rate:${carrier}:${tin}:${month}`, kind: "rate_change", carrier: name, state: providerState(tin), occurredAt: when,
        importance: Math.abs(med) >= 0.15 || ch.length >= 10 ? 4 : Math.abs(med) >= 0.08 ? 3 : 2,
        url: `/rates?code=${encodeURIComponent(`${top.r.codeType}|${top.r.code}`)}&class=${top.r.billingClass}&state=${providerState(tin) ?? "all"}`,
        title: `${name} rates at ${prov} ${med >= 0 ? "up" : "down"} ${Math.abs(med * 100).toFixed(0)}% (${ch.length} service${ch.length === 1 ? "" : "s"})`,
        summary: `Negotiated rates in ${name}'s ${month} files vs ${prevMonth}. Largest: ${label(top.r)} ${pctTxt(top.d)} ($${Math.round(top.r.prev!).toLocaleString()} → $${Math.round(top.r.cur!).toLocaleString()}).${sorted.slice(1, 4).map((x) => ` ${label(x.r)} ${pctTxt(x.d)}.`).join("")} Each figure is the median of the rates the file lists for that provider and service, so a large swing can mean a new contract or a change in which rates are listed.`,
        data: { tin, services: ch.length, median: med },
      });
    }
    if (!comparable) continue;
    // Network changes: hospitals (inpatient DRG prices) appearing or disappearing.
    for (const [kind, set] of [["network_add", mineH.filter((h) => h.cur && !h.prev).map((h) => h.tin)], ["network_drop", mineH.filter((h) => h.prev && !h.cur).map((h) => h.tin)]] as const) {
      for (const tin of set) {
        const prov = irsName(tin) ?? `TIN ${tin}`;
        out.push({
          eventKey: `${kind}:${carrier}:${tin}:${month}`, kind, carrier: name, state: providerState(tin), occurredAt: when, importance: 4,
          url: `/networks?state=${providerState(tin) ?? "all"}`,
          title: kind === "network_add" ? `${prov} appears in ${name}'s network` : `${prov} no longer in ${name}'s rate files`,
          summary: kind === "network_add"
            ? `${name}'s ${month} files price inpatient care at ${prov}; ${prevMonth}'s didn't.`
            : `${name}'s ${prevMonth} files priced inpatient care at ${prov}; ${month}'s don't. Could be a contract termination — or a coding change in the file; check before acting.`,
          data: { tin },
        });
      }
    }
  }
  return out;
}

export const currentMonth = () => new Date().toISOString().slice(0, 7);
export function shiftMonth(m: string, d: number) {
  const [y, mo] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + d, 1));
  return t.toISOString().slice(0, 7);
}

// ── Fan-out ─────────────────────────────────────────────────────────────────────────────────────

const TYPE: Record<string, "PRICING" | "NETWORK" | "OTHER" | "FINANCIAL"> = {
  account_won: "OTHER", account_lost: "OTHER", rate_filing: "PRICING", rate_change: "PRICING", network_add: "NETWORK", network_drop: "NETWORK",
};

/**
 * "New" means newly *detected*, not recently dated: a Form 5500 switch is dated at the plan-year start, months before
 * the filing exists. The first batch of each filing-based kind (the initial load of years of history) is back-history;
 * anything detected after that is news. Rate and network changes are monthly comparisons, so every batch is news.
 */
const BOOTSTRAPPED = new Set(["account_won", "account_lost", "rate_filing"]);
export async function bootstrapCutoffs() {
  const firsts = await db.marketEvent.groupBy({ by: ["kind"], _min: { createdAt: true } });
  return new Map(firsts.map((f) => [f.kind, new Date(f._min.createdAt!.getTime() + 24 * 3600e3)]));
}
export function isNewlyDetected(e: { kind: string; createdAt: Date }, cutoffs: Map<string, Date>, withinMs = 48 * 3600e3, now = Date.now()) {
  if (BOOTSTRAPPED.has(e.kind) && e.createdAt <= (cutoffs.get(e.kind) ?? new Date(0))) return false;
  return now - e.createdAt.getTime() < withinMs;
}

/**
 * Every event whose carrier matches a workspace competitor becomes a Signal there (idempotent via the signal dedupe
 * key). Runs after imports and hourly, so competitors added later get the back-history too.
 */
export async function syncEventsToWorkspaces(): Promise<number> {
  const events = await db.marketEvent.findMany({ orderBy: { occurredAt: "asc" } });
  if (!events.length) return 0;
  const workspaces = await db.workspace.findMany({ select: { id: true, competitors: { select: { id: true, name: true, aliases: true, issuerPattern: true } } } });
  const cutoffs = await bootstrapCutoffs();
  let created = 0;
  for (const ws of workspaces) {
    const matchers = ws.competitors.flatMap((c) => { try { return [{ c, re: new RegExp(issuerPatternFor(c), "i") }]; } catch { return []; } });
    if (!matchers.length) continue;
    const have = new Set((await db.signal.findMany({ where: { workspaceId: ws.id, tags: { some: { tag: { name: "market-data" } } } }, select: { url: true, title: true } })).map((s) => `${s.title}`));
    for (const e of events) {
      const m = matchers.find((x) => x.re.test(e.carrier));
      if (!m || have.has(e.title)) continue;
      const fresh = isNewlyDetected(e, cutoffs);
      const s = await ingestSignal(ws.id, {
        title: e.title, summary: e.summary, url: e.url ?? undefined, competitorId: m.c.id, type: TYPE[e.kind] ?? "OTHER", importance: e.importance,
        publishedAt: e.occurredAt, tags: ["market-data", e.kind.replace("_", "-")], silent: !fresh,
      });
      if (s) created++;
    }
  }
  return created;
}

/** Run every detector and store results. Called from the market-data import process. */
export async function detectAll(which: Array<"accounts" | "filings" | "rates"> = ["accounts", "filings", "rates"]) {
  const evs: EventInput[] = [];
  if (which.includes("accounts")) evs.push(...(await detectAccountChanges()));
  if (which.includes("filings")) evs.push(...(await detectFilingChanges()));
  if (which.includes("rates")) evs.push(...(await detectRateChanges()));
  return writeEvents(evs);
}
