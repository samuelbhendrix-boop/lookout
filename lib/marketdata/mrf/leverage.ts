import { db } from "../../db";
import { HOSPITALS } from "../networks";
import { hospitalFor, irsName, medicareFor, providerState } from "./medicare";
import { isSuspect } from "./queries";

/**
 * Price leverage: what each carrier pays each hospital, as a multiple of what Medicare would pay that same hospital
 * for the same services. One number per hospital × carrier (median across the facility services both price), so
 * hospitals and carriers can be compared on one scale. Built from the latest month of RateHistory (carrier-level
 * medians per provider and service), in the import process, and stored; the web process only reads it.
 */
export type LeverageCell = { pct: number; n: number; inpatient: number | null; outpatient: number | null };
export type LeverageRow = {
  tin: string; name: string; state: string | null; type: string | null; carriers: Record<string, LeverageCell>;
  spread: number | null; low: string | null; high: string | null;
};
export type LeverageCarrier = { carrier: string; carrierName: string; hospitals: number; median: number | null; vsPeers: number | null; lowest: number; highest: number; uniform: boolean };
export type PublishedRow = { hospital: string; tin: string | null; state: string | null; cells: Record<string, LeverageCell> };
export type Published = { rows: PublishedRow[]; columns: Array<{ key: string; carrier: string; product: string; hospitals: number; median: number | null }>; files: number; check: Array<{ carrier: string; pairs: number; medianDiff: number }> };
export type Leverage = { month: string | null; rows: LeverageRow[]; carriers: LeverageCarrier[]; excluded: { outliers: number; noMedicare: number }; published?: Published };

const LEVERAGE_ID = "cache:leverage";
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const byCcn = new Map(HOSPITALS.map((h) => [h.ccn, h]));

export async function computeLeverage(): Promise<Leverage> {
  const latest = await db.rateHistory.aggregate({ _max: { month: true } });
  const month = latest._max.month;
  if (!month) return { month: null, rows: [], carriers: [], excluded: { outliers: 0, noMedicare: 0 } };
  const rows = await db.rateHistory.findMany({
    where: { month, billingClass: "institutional" },
    select: { carrier: true, carrierName: true, tin: true, codeType: true, code: true, median: true },
  });
  const names = new Map<string, string>();
  const acc = new Map<string, Map<string, { all: number[]; ip: number[]; op: number[] }>>(); // tin → carrier → ratios
  let outliers = 0, noMedicare = 0;
  // Same basket for every carrier at a hospital: only services that 2+ carriers price there (otherwise one carrier's
  // number is mostly MRIs and another's mostly ER visits).
  const shared = new Map<string, Set<string>>();
  for (const r of rows) { const k = `${r.tin}|${r.codeType}|${r.code}`; (shared.get(k) ?? shared.set(k, new Set()).get(k)!).add(r.carrier); }
  for (const r of rows) {
    if ((shared.get(`${r.tin}|${r.codeType}|${r.code}`)?.size ?? 0) < 2) continue;
    names.set(r.carrier, r.carrierName);
    const m = medicareFor(r.codeType, r.code, "institutional", r.tin);
    if (!m.amount) { noMedicare++; continue; }
    if (isSuspect(r.median, m.amount)) { outliers++; continue; }
    const t = acc.get(r.tin) ?? acc.set(r.tin, new Map()).get(r.tin)!;
    const c = t.get(r.carrier) ?? t.set(r.carrier, { all: [], ip: [], op: [] }).get(r.carrier)!;
    const ratio = r.median / m.amount;
    c.all.push(ratio);
    (r.codeType.endsWith("DRG") ? c.ip : c.op).push(ratio);
  }
  const out: LeverageRow[] = [];
  for (const [tin, cs] of acc) {
    const h = hospitalFor(tin);
    const hosp = h && "h" in h ? byCcn.get(h.ccn) : undefined;
    // Hospitals only: a facility that bills inpatient stays for someone, or a matched hospital TIN.
    const isHospital = !!hosp || [...cs.values()].some((c) => c.ip.length > 0);
    if (!isHospital) continue;
    const carriers: Record<string, LeverageCell> = {};
    for (const [c, v] of cs) {
      if (v.all.length < 3) continue; // too few shared services to say anything
      carriers[c] = { pct: median(v.all)!, n: v.all.length, inpatient: median(v.ip), outpatient: median(v.op) };
    }
    const entries = Object.entries(carriers).sort((a, b) => a[1].pct - b[1].pct);
    if (!entries.length) continue;
    out.push({
      tin, name: hosp?.name ?? irsName(tin) ?? `TIN ${tin}`, state: hosp?.state ?? providerState(tin), type: hosp?.type ?? null, carriers,
      spread: entries.length >= 2 ? entries.at(-1)![1].pct / entries[0][1].pct : null,
      low: entries.length >= 2 ? entries[0][0] : null, high: entries.length >= 2 ? entries.at(-1)![0] : null,
    });
  }
  // A carrier paying the identical multiple at many hospitals is publishing one fee schedule, not hospital contracts:
  // flagged, and left out of best/worst-deal rankings.
  const uniform = new Set<string>();
  for (const c of new Set(out.flatMap((r) => Object.keys(r.carriers)))) {
    const vals = out.filter((r) => r.carriers[c]).map((r) => r.carriers[c].pct.toFixed(3));
    const top = Math.max(...Object.values(vals.reduce<Record<string, number>>((m, v) => ((m[v] = (m[v] ?? 0) + 1), m), {})));
    if (vals.length >= 5 && top / vals.length >= 0.3) uniform.add(c);
  }
  for (const r of out) {
    const ranked = Object.entries(r.carriers).filter(([c]) => !uniform.has(c)).sort((a, b) => a[1].pct - b[1].pct);
    r.spread = ranked.length >= 2 ? ranked.at(-1)![1].pct / ranked[0][1].pct : null;
    r.low = ranked.length >= 2 ? ranked[0][0] : null;
    r.high = ranked.length >= 2 ? ranked.at(-1)![0] : null;
  }
  out.sort((a, b) => Object.keys(b.carriers).length - Object.keys(a.carriers).length || (b.spread ?? 0) - (a.spread ?? 0));
  const carrierIds = [...new Set(out.flatMap((r) => Object.keys(r.carriers)))];
  const carriers: LeverageCarrier[] = carrierIds.map((c) => {
    const mine = out.filter((r) => r.carriers[c]);
    // vs peers: this carrier's multiple ÷ the median of the other carriers' multiples at the same hospital.
    const rel = mine.map((r) => { const others = Object.entries(r.carriers).filter(([k]) => k !== c && !uniform.has(k)).map(([, v]) => v.pct); return others.length ? r.carriers[c].pct / median(others)! : null; }).filter((x): x is number => x != null);
    return {
      carrier: c, carrierName: names.get(c) ?? c, hospitals: mine.length, median: median(mine.map((r) => r.carriers[c].pct)),
      vsPeers: rel.length >= 3 ? median(rel) : null, uniform: uniform.has(c), lowest: out.filter((r) => r.low === c).length, highest: out.filter((r) => r.high === c).length,
    };
  }).sort((a, b) => b.hospitals - a.hospitals);
  return { month, rows: out, carriers, excluded: { outliers, noMedicare } };
}

/**
 * The same multiple-of-Medicare view from hospitals' own price files, by carrier and product (HMO, PPO, …): covers
 * carriers whose rate files we can't reach and splits products. Also cross-checks hospital-published rates against the
 * carrier's own rate files where both exist.
 */
export async function computePublished(): Promise<Published | undefined> {
  const rows = await db.hospitalRate.findMany({ where: { dollar: { gt: 0 } }, select: { hospital: true, tin: true, state: true, codeType: true, code: true, carrier: true, product: true, dollar: true } });
  if (!rows.length) return undefined;
  const files = await db.hospitalFile.count({ where: { status: "ok" } });
  const key = (r: { carrier: string | null; product: string | null }) => `${r.carrier}|${r.product}`;
  // Per hospital × carrier-product × service: median published dollar (files often list several rows per code).
  const cells = new Map<string, { hospital: string; tin: string | null; state: string | null; k: string; codeType: string; code: string; v: number[] }>();
  for (const r of rows) {
    const id = `${r.hospital}|${key(r)}|${r.codeType}|${r.code}`;
    const c = cells.get(id) ?? cells.set(id, { hospital: r.hospital, tin: r.tin, state: r.state, k: key(r), codeType: r.codeType, code: r.code, v: [] }).get(id)!;
    c.v.push(r.dollar!);
  }
  const shared = new Map<string, Set<string>>();
  for (const c of cells.values()) { const id = `${c.hospital}|${c.codeType}|${c.code}`; (shared.get(id) ?? shared.set(id, new Set()).get(id)!).add(c.k); }
  const acc = new Map<string, { hospital: string; tin: string | null; state: string | null; by: Map<string, { all: number[]; ip: number[]; op: number[] }> }>();
  for (const c of cells.values()) {
    if ((shared.get(`${c.hospital}|${c.codeType}|${c.code}`)?.size ?? 0) < 2) continue;
    const m = medicareFor(c.codeType, c.code, "institutional", c.tin ?? undefined, c.state ?? "MA");
    const v = median(c.v)!;
    if (!m.amount || isSuspect(v, m.amount)) continue;
    const h = acc.get(c.hospital) ?? acc.set(c.hospital, { hospital: c.hospital, tin: c.tin, state: c.state, by: new Map() }).get(c.hospital)!;
    const x = h.by.get(c.k) ?? h.by.set(c.k, { all: [], ip: [], op: [] }).get(c.k)!;
    x.all.push(v / m.amount);
    (c.codeType.endsWith("DRG") ? x.ip : x.op).push(v / m.amount);
  }
  const out: PublishedRow[] = [...acc.values()].map((h) => ({
    hospital: h.hospital, tin: h.tin, state: h.state,
    cells: Object.fromEntries([...h.by].filter(([, v]) => v.all.length >= 3).map(([k, v]) => [k, { pct: median(v.all)!, n: v.all.length, inpatient: median(v.ip), outpatient: median(v.op) }])),
  })).filter((r) => Object.keys(r.cells).length >= 2).sort((a, b) => Object.keys(b.cells).length - Object.keys(a.cells).length);
  const keys = [...new Set(out.flatMap((r) => Object.keys(r.cells)))];
  const columns = keys.map((k) => { const [carrier, product] = k.split("|"); const xs = out.filter((r) => r.cells[k]).map((r) => r.cells[k].pct); return { key: k, carrier, product, hospitals: xs.length, median: median(xs) }; })
    .filter((c) => c.hospitals >= 1).sort((a, b) => b.hospitals - a.hospitals);
  // Cross-check: same hospital (TIN), same carrier, same service — hospital file vs the carrier's own rate file.
  const month = (await db.rateHistory.aggregate({ _max: { month: true } }))._max.month;
  const check: Published["check"] = [];
  if (month) {
    const tins = [...new Set(rows.map((r) => r.tin).filter(Boolean))] as string[];
    const hist = await db.rateHistory.findMany({ where: { month, billingClass: "institutional", tin: { in: tins } }, select: { carrierName: true, tin: true, codeType: true, code: true, median: true } });
    const byCarrier = new Map<string, number[]>();
    const pub = new Map<string, number>();
    for (const c of cells.values()) if (c.tin) pub.set(`${c.tin}|${c.k.split("|")[0]}|${c.codeType}|${c.code}`, median(c.v)!);
    const canon = (n: string) => (/blue cross blue shield of massachusetts/i.test(n) ? "Blue Cross Blue Shield of Massachusetts" : /anthem/i.test(n) ? "Anthem Blue Cross and Blue Shield" : /mass general brigham/i.test(n) ? "Mass General Brigham Health Plan" : n);
    for (const h of hist) {
      const p = pub.get(`${h.tin}|${canon(h.carrierName)}|${h.codeType}|${h.code}`);
      if (!p || !h.median) continue;
      const d = Math.abs(p / h.median - 1);
      (byCarrier.get(canon(h.carrierName)) ?? byCarrier.set(canon(h.carrierName), []).get(canon(h.carrierName))!).push(d);
    }
    for (const [carrier, ds] of byCarrier) if (ds.length >= 5) check.push({ carrier, pairs: ds.length, medianDiff: median(ds)! });
  }
  return { rows: out, columns, files, check: check.sort((a, b) => b.pairs - a.pairs) };
}

export async function refreshLeverage() {
  const value = await computeLeverage();
  value.published = await computePublished();
  const data = { carrier: "_cache", carrierName: "_cache", network: "leverage", url: "", status: "cache", stats: JSON.parse(JSON.stringify(value)), processedAt: new Date() };
  await db.rateFile.upsert({ where: { id: LEVERAGE_ID }, create: { id: LEVERAGE_ID, ...data }, update: data });
  return value;
}

export async function leverage(): Promise<Leverage | null> {
  const row = await db.rateFile.findUnique({ where: { id: LEVERAGE_ID } });
  return (row?.stats as unknown as Leverage) ?? null;
}
