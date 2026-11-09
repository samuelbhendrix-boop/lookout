import { db } from "../db";
import { canonicalCarrier } from "./events";
import { issuerPatternFor } from "./queries";
import { NON_MAJOR_MEDICAL } from "./dol";
import { sectorOf } from "./employers";

/**
 * Accounts in play: employer health plans renewing soon, ranked by evidence that the account is winnable. Evidence
 * comes from the employer's own Form 5500 history (premium per person, claims vs premium, broker changes) and from
 * what its carrier just did (rate filings, network changes). Every reason is shown; nothing is a prediction.
 */
export type Reason = { label: string; detail: string; weight: number };
export type InPlay = {
  ein: string; planNum: string; sponsor: string; city: string | null; state: string; sector: string; participants: number | null;
  carrier: string; competitorId: string | null; competitorName: string | null; funding: string;
  renewal: Date; daysOut: number; filingYear: number;
  persons: number | null; premium: number | null; perPerson: number | null; lossRatio: number | null;
  brokers: string[]; reasons: Reason[]; score: number;
};

type CarrierYear = { persons: number; premium: number; pricedPersons: number; claims: number; claimsPremium: number; brokers: Set<string> };
type YearView = { year: number; planYearBegin: Date; participants: number | null; funding: string; carriers: Map<string, CarrierYear>; brokers: Set<string>; policyFrom: Date | null };

const BROKER_GENERIC = new Set(["INC", "LLC", "LLP", "LP", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "THE", "OF", "AND", "INSURANCE", "SERVICES", "SERVICE", "BENEFITS", "BENEFIT", "GROUP", "AGENCY", "FINANCIAL", "ASSOCIATES", "CONSULTING", "CONSULTANTS", "PARTNERS", "ADVISORS", "SOLUTIONS", "NEW", "ENGLAND", "USA", "US", "NORTHEAST", "HEALTH"]);
/** Schedule A broker names are free text ("HUB INTERNATIONAL N E LLC", "CARRAGHER, BRIAN"); reduce them to a stable key. */
export function brokerKey(n: string) {
  let s = n.toUpperCase().trim();
  const comma = /^([A-Z'-]+),\s*([A-Z'-]+)$/.exec(s); // "LAST, FIRST" → "FIRST LAST"
  if (comma) s = `${comma[2]} ${comma[1]}`;
  s = s.replace(/&/g, " AND ").replace(/[.,()\-\/]/g, " ").replace(/\bINS\b/g, "INSURANCE").replace(/\bSVCS?\b/g, "SERVICES").replace(/\bN E\b|\bNE\b/g, "NEW ENGLAND").replace(/\bMGMT\b/g, "MANAGEMENT").replace(/\bASSOC\b/g, "ASSOCIATES");
  s = s.replace(/\bNEWFRONT\b/g, "ABD"); // Newfront and ABD merged; filings use both names
  const tokens = s.split(/\s+/).filter(Boolean);
  const core = tokens.filter((t) => !BROKER_GENERIC.has(t));
  return (core.length ? core : tokens).join(" ");
}
/** Same broker if the distinctive words overlap — spelling drift between years must not read as a broker change. */
export function sameBroker(a: string, b: string) {
  const A = new Set(a.split(" ")), B = b.split(" ");
  return B.some((t) => t.length >= 3 && A.has(t));
}
const BROKER_DISPLAY = new Map<string, string>();
const titleCase = (n: string) => n.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Llc|Inc|Usa|Hub|Nfp|Usi|Aon|Mma|Abd|Hp)\b/g, (m) => m.toUpperCase()).replace(/\bAnd\b/g, "&");
const nice = (k: string) => BROKER_DISPLAY.get(k) ?? titleCase(k);
/** Carrier names are free text too; fix the common typo before matching and give unknown carriers a stable key. */
const carrierName = (raw: string) => {
  const fixed = raw.replace(/SHEILD/gi, "SHIELD");
  return canonicalCarrier(fixed) ?? fixed.toUpperCase().replace(/[.,]/g, "").replace(/\b(INC|CO|COMPANY|CORP|CORPORATION)\b/g, "").replace(/\s+/g, " ").trim();
};
export const isKnownCarrier = (name: string) => canonicalCarrier(name) === name;

/** Next anniversary of a date on or after `from`. */
export function nextAnniversary(d: Date, from = new Date()) {
  const a = new Date(Date.UTC(from.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (a.getTime() < Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) a.setUTCFullYear(a.getUTCFullYear() + 1);
  return a;
}

/** The medical carrier: most premium, then most people. */
const mainCarrier = (v: YearView) => [...v.carriers.entries()].sort((a, b) => b[1].premium - a[1].premium || b[1].persons - a[1].persons)[0]?.[0] ?? null;

/** Per plan (EIN + plan number): one view per plan year with major-medical contracts rolled up. */
const HISTORY_TTL = 15 * 60_000;
type Histories = Awaited<ReturnType<typeof loadPlanHistories>>;
let historyCache: { at: number; value: Promise<Histories> } | null = null;
/**
 * Filings change monthly; build the roll-up once for all states and reuse it for a few minutes, rather than
 * re-reading ~20k rows on every page view (which also keeps the web process's memory flat).
 */
async function planHistories(state: string | null) {
  if (!historyCache || Date.now() - historyCache.at > HISTORY_TTL) {
    historyCache = { at: Date.now(), value: loadPlanHistories() };
    historyCache.value.catch(() => { historyCache = null; });
  }
  const all = await historyCache.value;
  return state ? new Map([...all].filter(([, v]) => v.meta.state === state)) : all;
}
async function loadPlanHistories() {
  const plans = await db.employerPlan.findMany({
    where: { planYearBegin: { gte: new Date("2021-01-01") } },
    select: { id: true, ein: true, planNum: true, sponsor: true, city: true, state: true, naics: true, participants: true, planYearBegin: true, funding: true },
    orderBy: { planYearBegin: "asc" },
  });
  const contracts = await db.employerContract.findMany({
    where: { kind: "health" },
    select: { planId: true, carrier: true, personsCovered: true, premium: true, claims: true, brokers: true, policyFrom: true },
  });
  const byPlan = new Map<string, typeof contracts>();
  for (const c of contracts) (byPlan.get(c.planId) ?? byPlan.set(c.planId, []).get(c.planId)!).push(c);
  const out = new Map<string, { meta: (typeof plans)[number]; years: YearView[] }>();
  for (const p of plans) {
    const k = `${p.ein}|${p.planNum}`;
    const v: YearView = { year: p.planYearBegin.getUTCFullYear(), planYearBegin: p.planYearBegin, participants: p.participants, funding: p.funding, carriers: new Map(), brokers: new Set(), policyFrom: null };
    for (const c of byPlan.get(p.id) ?? []) {
      if (NON_MAJOR_MEDICAL.test(c.carrier)) continue;
      // Supplemental contracts (no premium reported, a sliver of the group) aren't the medical carrier.
      const name = carrierName(c.carrier);
      const x = v.carriers.get(name) ?? { persons: 0, premium: 0, pricedPersons: 0, claims: 0, claimsPremium: 0, brokers: new Set<string>() };
      x.persons += c.personsCovered ?? 0;
      if ((c.premium ?? 0) > 0 && (c.personsCovered ?? 0) > 0) { x.premium += c.premium!; x.pricedPersons += c.personsCovered!; }
      if ((c.premium ?? 0) > 0 && (c.claims ?? 0) > 0) { x.claims += c.claims!; x.claimsPremium += c.premium!; }
      v.carriers.set(name, x);
      v.policyFrom ??= c.policyFrom;
      for (const b of (c.brokers as Array<{ name: string }> | null) ?? []) if (b.name) { const k = brokerKey(b.name); x.brokers.add(k); if (!BROKER_DISPLAY.has(k)) BROKER_DISPLAY.set(k, titleCase(b.name.replace(/[.,]/g, "").replace(/\b(LLC|INC|LLP|CORP)\b/gi, "").replace(/\s+/g, " ").trim())); }
    }
    // Broker of record = the brokers on the medical carrier's contracts (not those selling supplemental lines).
    const main = mainCarrier(v);
    if (main) v.brokers = v.carriers.get(main)!.brokers;
    const e = out.get(k) ?? { meta: p, years: [] };
    e.meta = p;
    e.years = [...e.years.filter((y) => y.year !== v.year), v]; // latest filing for a plan year wins
    out.set(k, e);
  }
  return out;
}
export async function accountsInPlay(workspaceId: string, f: { state?: string; days?: number; scope?: "competitors" | "all"; competitorId?: string; min?: number }) {
  const state = f.state && /^[A-Z]{2}$/.test(f.state) ? f.state : null;
  const days = f.days ?? 120;
  const competitors = await db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } });
  const matchers = competitors.flatMap((c) => { try { return [{ c, re: new RegExp(issuerPatternFor(c), "i") }]; } catch { return []; } });
  const histories = await planHistories(state);

  // What carriers did lately: filings (last 18 months) and network/rate moves (last 3), by carrier and state.
  const events = await db.marketEvent.findMany({
    where: { OR: [{ kind: "rate_filing", occurredAt: { gte: new Date(Date.now() - 548 * 864e5) } }, { kind: { in: ["network_drop", "rate_change"] }, occurredAt: { gte: new Date(Date.now() - 92 * 864e5) } }] },
    select: { kind: true, carrier: true, state: true, title: true, importance: true, data: true },
  });
  const largeGroup = await db.groupRateAction.findMany({ where: { segment: "LARGE_GROUP", isTotal: false }, orderBy: { planYear: "desc" } });
  const carrierReasons = (carrier: string, st: string): Reason[] => {
    const canon = canonicalCarrier(carrier) ?? carrier;
    const mine = events.filter((e) => (canonicalCarrier(e.carrier) ?? e.carrier) === canon && e.state === st);
    const out: Reason[] = [];
    const lg = largeGroup.find((g) => g.state === st && (canonicalCarrier(g.carrier) ?? g.carrier) === canon && (g.approved ?? g.requested) != null);
    if (lg) {
      const x = (lg.approved ?? lg.requested)!;
      const p = Math.abs(x) < 1 ? x * 100 : x;
      if (p >= 8) out.push({ label: `Large-group rates +${p.toFixed(1)}%`, detail: `${st} regulator: ${lg.approved != null ? "approved" : "requested"} ${lg.planYear} large-group increase for ${canon}.`, weight: 2 });
    }
    const filings = mine.filter((e) => e.kind === "rate_filing").map((e) => ({ e, p: Number(/([+−-]\d+(?:\.\d+)?)%/.exec(e.title)?.[1].replace("−", "-") ?? NaN) })).filter((x) => x.p >= 8).sort((a, b) => b.p - a.p);
    if (filings[0] && !lg) out.push({ label: `Filed +${filings[0].p.toFixed(0)}% in ${st}`, detail: `${filings[0].e.title}. Individual/small-group filing — directional for larger groups, not their rate.`, weight: 1 });
    const drops = mine.filter((e) => e.kind === "network_drop");
    if (drops.length) out.push({ label: `Lost ${drops.length} hospital${drops.length === 1 ? "" : "s"}`, detail: drops.slice(0, 3).map((d) => d.title).join("; "), weight: 2 });
    const ups = mine.filter((e) => e.kind === "rate_change" && ((e.data as { median?: number } | null)?.median ?? 0) > 0);
    if (ups.length >= 3) out.push({ label: `Paying more at ${ups.length} providers`, detail: `${canon}'s negotiated rates rose at ${ups.length} ${st} providers in the last quarter — cost that reaches premiums.`, weight: 1 });
    return out;
  };

  const { asoAccounts, asoBenchmarks } = await import("./aso");
  const asoBy = new Map((await asoAccounts()).map((a) => [`${a.ein}|${a.planNum}`, a]));
  const asoMedian = new Map((await asoBenchmarks()).filter((b) => b.withFee >= 5).map((b) => [b.admin, b.median!]));
  const now = new Date();
  const rows: InPlay[] = [];
  let considered = 0, noRenewalInWindow = 0, selfFundedSkipped = 0, staleSkipped = 0;
  for (const { meta, years } of histories.values()) {
    years.sort((a, b) => a.year - b.year);
    const cur = years.at(-1)!;
    if (cur.year < now.getUTCFullYear() - 3) { staleSkipped++; continue; } // stopped filing: plan likely ended or merged
    // Self-funded plans have no insurance contract; Schedule C names their claims administrator where it's filed.
    const aso = mainCarrier(cur) ? null : asoBy.get(`${meta.ein}|${meta.planNum}`) ?? null;
    const carrier = mainCarrier(cur) ?? aso?.admin ?? null;
    if (!carrier) { selfFundedSkipped++; continue; }
    if ((meta.participants ?? 0) < (f.min ?? 0)) continue;
    considered++;
    const renewal = nextAnniversary(cur.policyFrom ?? cur.planYearBegin, now);
    const daysOut = Math.round((renewal.getTime() - now.getTime()) / 864e5);
    if (daysOut > days) { noRenewalInWindow++; continue; }
    const m = matchers.find((x) => x.re.test(carrier));
    if (f.scope !== "all" && !m) continue;
    if (f.competitorId && m?.c.id !== f.competitorId) continue;

    const prev = years.at(-2)?.year === cur.year - 1 ? years.at(-2)! : null;
    const reasons: Reason[] = [];
    const c1 = cur.carriers.get(carrier) ?? { persons: 0, premium: 0, pricedPersons: 0, claims: 0, claimsPremium: 0, brokers: new Set<string>() };
    if (aso) {
      const med = asoMedian.get(aso.admin);
      if (aso.pepm && med) {
        const r = aso.pepm / med - 1;
        if (r >= 0.25) reasons.push({ label: `Admin fee +${Math.round(r * 100)}% vs ${aso.admin.split(" ")[0]} median`, detail: `Paid ${aso.name} $${Math.round(aso.fee!).toLocaleString()} in ${aso.year} — $${aso.pepm.toFixed(0)} per participant per month vs a $${med.toFixed(0)} median across ${aso.admin}'s self-funded accounts on Schedule C.`, weight: 2 });
        else if (r <= -0.25) reasons.push({ label: `Admin fee ${Math.round(r * 100)}% vs median`, detail: `$${aso.pepm.toFixed(0)} per participant per month vs a $${med.toFixed(0)} median for ${aso.admin} — a low-fee account, hard to undercut on price.`, weight: -1 });
      }
      reasons.push({ label: "Self-funded (ASO)", detail: `Claims administered by ${aso.name}; no insured premium is filed, so premium-based signals don't apply.`, weight: 0 });
    }
    const c0 = prev?.carriers.get(carrier) ?? null;
    const pp = c1.pricedPersons > 0 ? c1.premium / c1.pricedPersons : null;
    const ppPrev = c0 && c0.pricedPersons > 0 ? c0.premium / c0.pricedPersons : null;
    // Same carrier both years and a comparable head count, or a census or partial-year change reads as a price change.
    if (pp && ppPrev && Math.abs(c1.pricedPersons / c0!.pricedPersons - 1) < 0.25) {
      const ch = pp / ppPrev - 1;
      if (ch >= 0.1 && ch < 0.6) reasons.push({ label: `Premium per person +${(ch * 100).toFixed(0)}%`, detail: `$${Math.round(ppPrev).toLocaleString()} → $${Math.round(pp).toLocaleString()} per covered person with ${carrier}, plan year ${prev!.year} → ${cur.year}.`, weight: ch >= 0.15 ? 3 : 2 });
    }
    const lr = c1.claimsPremium > 0 ? c1.claims / c1.claimsPremium : null;
    if (lr != null && lr > 0.2 && lr < 2) {
      if (lr >= 0.92) reasons.push({ label: `Claims ${Math.round(lr * 100)}% of premium`, detail: `${carrier} paid out nearly all it collected in ${cur.year}; expect it to push a large renewal increase.`, weight: 2 });
      else if (lr <= 0.7) reasons.push({ label: `Claims only ${Math.round(lr * 100)}% of premium`, detail: `The group ran well in ${cur.year} — it is likely overpaying and can be undercut profitably.`, weight: 2 });
    }
    // New only if it matches no broker in any earlier year (a firm that reappears, or was renamed and back, isn't new).
    const earlier = new Set(years.slice(0, -1).flatMap((y) => [...y.brokers]));
    if (prev && prev.brokers.size && cur.brokers.size && ![...cur.brokers].some((b) => [...earlier].some((a) => sameBroker(a, b))))
      reasons.push({ label: "New broker", detail: `Broker of record changed in ${cur.year}: ${[...prev.brokers].map(nice).join(", ")} → ${[...cur.brokers].map(nice).join(", ")}. New brokers usually re-market the account.`, weight: 2 });
    const tenure = (() => { let n = 1; for (let i = years.length - 2; i >= 0 && years[i].year === years[i + 1].year - 1 && mainCarrier(years[i]) === carrier; i--) n++; return n; })();
    if (prev && mainCarrier(prev) && mainCarrier(prev) !== carrier) reasons.push({ label: "Switched last year", detail: `Moved from ${mainCarrier(prev)} to ${carrier} in ${cur.year}; unlikely to move again so soon.`, weight: -2 });
    else if (tenure >= 3 && years.length >= 3) reasons.push({ label: `${tenure}+ years with carrier`, detail: `Same carrier in every filing since ${cur.year - tenure + 1}. Sticky — but not marketed recently either.`, weight: 0 });
    // Premium filings don't apply to self-funded accounts; a narrower network does.
    reasons.push(...carrierReasons(carrier, meta.state).filter((r) => !aso || r.label.startsWith("Lost")));

    rows.push({
      ein: meta.ein, planNum: meta.planNum, sponsor: meta.sponsor, city: meta.city, state: meta.state, sector: sectorOf(meta.naics), participants: meta.participants,
      carrier, competitorId: m?.c.id ?? null, competitorName: m?.c.name ?? null, funding: cur.funding, renewal, daysOut, filingYear: cur.year,
      persons: c1.persons || null, premium: c1.premium || null, perPerson: pp, lossRatio: lr != null && lr > 0.2 && lr < 2 ? lr : null,
      brokers: aso ? aso.brokers.map((b) => titleCase(b)) : [...cur.brokers].map(nice), reasons, score: reasons.reduce((s, r) => s + r.weight, 0),
    });
  }
  rows.sort((a, b) => b.score - a.score || (b.persons ?? 0) - (a.persons ?? 0));
  return { rows, considered, noRenewalInWindow, selfFundedSkipped, staleSkipped, days };
}

/** Who moves accounts: for every plan whose main carrier changed between consecutive plan years, credit the new year's broker. */
export async function brokerLeague(state?: string) {
  const histories = await planHistories(state && /^[A-Z]{2}$/.test(state) ? state : null);
  type B = { key: string; name: string; accounts: number; persons: number; moves: number; movedPersons: number; flows: Map<string, number>; carriers: Map<string, number> };
  const brokers = new Map<string, B>();
  const get = (k: string) => brokers.get(k) ?? brokers.set(k, { key: k, name: nice(k), accounts: 0, persons: 0, moves: 0, movedPersons: 0, flows: new Map(), carriers: new Map() }).get(k)!;
  let moves = 0, unattributed = 0;
  for (const { years } of histories.values()) {
    years.sort((a, b) => a.year - b.year);
    const cur = years.at(-1)!;
    const c = mainCarrier(cur);
    if (c) for (const b of cur.brokers) { const x = get(b); x.accounts++; x.persons += cur.carriers.get(c)!.persons; x.carriers.set(c, (x.carriers.get(c) ?? 0) + 1); }
    for (let i = 1; i < years.length; i++) {
      if (years[i].year !== years[i - 1].year + 1) continue;
      const from = mainCarrier(years[i - 1]), to = mainCarrier(years[i]);
      if (!from || !to || from === to || !isKnownCarrier(from) || !isKnownCarrier(to)) continue; // both sides must be recognised medical carriers
      moves++;
      if (!years[i].brokers.size) { unattributed++; continue; }
      for (const b of years[i].brokers) { const x = get(b); x.moves++; x.movedPersons += years[i].carriers.get(to)!.persons; x.flows.set(`${from} → ${to}`, (x.flows.get(`${from} → ${to}`) ?? 0) + 1); }
    }
  }
  const list = [...brokers.values()].filter((b) => b.accounts >= 3 || b.moves >= 1).map((b) => ({
    name: b.name, accounts: b.accounts, persons: b.persons, moves: b.moves, movedPersons: b.movedPersons,
    flows: [...b.flows.entries()].sort((a, z) => z[1] - a[1]).slice(0, 3).map(([flow, n]) => ({ flow, n })),
    carriers: [...b.carriers.entries()].sort((a, z) => z[1] - a[1]).slice(0, 4).map(([carrier, n]) => ({ carrier, n })),
  }));
  return { brokers: list.sort((a, b) => b.moves - a.moves || b.accounts - a.accounts), moves, unattributed };
}
