import { db } from "../../db";
import { BENCH_CODES, codeKey } from "./codes";

/** Dollar-denominated rate types, in preference order when a provider has several. Percent-of-charges and per diems aren't comparable. */
export const DOLLAR_TYPES = ["negotiated", "fee schedule", "derived"];
const pref = (t: string) => DOLLAR_TYPES.indexOf(t);
const CATEGORY = new Map(BENCH_CODES.map((c) => [codeKey(c.type, c.code), c.category]));
export const codeInfo = (codeType: string, code: string) => BENCH_CODES.find((c) => codeKey(c.type, c.code) === codeKey(codeType, code));

export async function rateFiles() {
  return db.rateFile.findMany({ orderBy: [{ carrierName: "asc" }, { network: "asc" }] });
}

/** Totals for the "how big was the raw data" line. */
export function compression(files: Awaited<ReturnType<typeof rateFiles>>) {
  let compressed = 0, scanned = 0, seconds = 0, kept = 0;
  for (const f of files) {
    const s = (f.stats ?? {}) as Record<string, number>;
    compressed += s.compressedBytes ?? 0;
    scanned += s.bytes ?? 0;
    seconds += s.seconds ?? 0;
    kept += (s.rows ?? 0);
  }
  return { compressed, scanned, seconds, kept };
}

type Pick = { fileId: string; tin: string; providerName: string | null; npiCount: number; median: number; min: number; max: number; negotiatedType: string };

/** One code, one billing class: network distributions per file plus a provider × file pivot. */
export async function codeBenchmark(codeType: string, code: string, billingClass: string) {
  const files = (await rateFiles()).filter((f) => f.status === "ok");
  const [sums, rows] = await Promise.all([
    db.rateSummary.findMany({ where: { codeType, code, billingClass, negotiatedType: { in: DOLLAR_TYPES } } }),
    db.providerRate.findMany({ where: { codeType, code, billingClass, negotiatedType: { in: DOLLAR_TYPES } } }),
  ]);
  const summary = new Map<string, (typeof sums)[number]>();
  for (const s of sums) {
    const cur = summary.get(s.fileId);
    if (!cur || s.providers > cur.providers) summary.set(s.fileId, s);
  }
  const best = new Map<string, Pick>();
  for (const r of rows) {
    const k = `${r.fileId}\t${r.tin}`;
    const cur = best.get(k);
    if (!cur || pref(r.negotiatedType) < pref(cur.negotiatedType)) best.set(k, r);
  }
  const byTin = new Map<string, { tin: string; name: string | null; npiCount: number; rates: Record<string, Pick> }>();
  for (const p of best.values()) {
    let x = byTin.get(p.tin);
    if (!x) byTin.set(p.tin, (x = { tin: p.tin, name: p.providerName, npiCount: p.npiCount, rates: {} }));
    x.rates[p.fileId] = p;
    x.npiCount = Math.max(x.npiCount, p.npiCount);
    if (!x.name && p.providerName) x.name = p.providerName;
  }
  const providers = [...byTin.values()]
    .map((p) => {
      const v = Object.values(p.rates).map((r) => r.median);
      return { ...p, carriers: new Set(Object.values(p.rates).map((r) => files.find((f) => f.id === r.fileId)?.carrier)).size, spread: v.length > 1 ? Math.max(...v) / Math.min(...v) : null, top: Math.max(...v) };
    })
    .sort((a, b) => b.carriers - a.carriers || b.top - a.top);
  return { files, summary, providers };
}

/**
 * Carrier price index: for every (service, billing class, provider) priced by 2+ carriers, each carrier's rate ÷ the
 * geometric mean across carriers; a carrier's index is the geometric mean of those ratios. 1.20 = pays 20% above peers
 * for the same service at the same provider. Networks of one carrier are averaged first.
 */
export async function carrierIndex() {
  const files = await db.rateFile.findMany({ where: { status: "ok" }, select: { id: true, carrier: true, carrierName: true } });
  const fileCarrier = new Map(files.map((f) => [f.id, f]));
  const rows = await db.providerRate.findMany({
    where: { negotiatedType: { in: DOLLAR_TYPES }, billingClass: { in: ["institutional", "professional"] } },
    select: { fileId: true, code: true, codeType: true, billingClass: true, tin: true, median: true, negotiatedType: true },
  });
  // file × service × provider → preferred type
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = `${r.fileId}\t${r.codeType}|${r.code}\t${r.billingClass}\t${r.tin}`;
    const cur = best.get(k);
    if (!cur || pref(r.negotiatedType) < pref(cur.negotiatedType)) best.set(k, r);
  }
  // service × provider → carrier → values (one per network)
  const cells = new Map<string, Map<string, number[]>>();
  for (const r of best.values()) {
    const f = fileCarrier.get(r.fileId);
    if (!f) continue;
    const k = `${r.codeType}|${r.code}\t${r.billingClass}\t${r.tin}`;
    let m = cells.get(k);
    if (!m) cells.set(k, (m = new Map()));
    let v = m.get(f.carrier);
    if (!v) m.set(f.carrier, (v = []));
    v.push(r.median);
  }
  const acc = new Map<string, { all: number[]; cat: Map<string, number[]>; providers: Set<string> }>();
  for (const [k, m] of cells) {
    if (m.size < 2) continue;
    const [ck, , tin] = k.split("\t");
    const vals = [...m.entries()].map(([c, v]) => [c, geo(v)] as const);
    const g = geo(vals.map((x) => x[1]));
    const cat = CATEGORY.get(ck) ?? "Other";
    for (const [c, v] of vals) {
      let a = acc.get(c);
      if (!a) acc.set(c, (a = { all: [], cat: new Map(), providers: new Set() }));
      const lr = Math.log(v / g);
      a.all.push(lr);
      a.providers.add(tin);
      let cv = a.cat.get(cat);
      if (!cv) a.cat.set(cat, (cv = []));
      cv.push(lr);
    }
  }
  const name = new Map(files.map((f) => [f.carrier, f.carrierName]));
  return [...acc.entries()]
    .map(([carrier, a]) => ({
      carrier,
      carrierName: name.get(carrier) ?? carrier,
      index: Math.exp(mean(a.all)),
      comparisons: a.all.length,
      providers: a.providers.size,
      byCategory: [...a.cat.entries()].map(([category, v]) => ({ category, index: Math.exp(mean(v)), n: v.length })).sort((x, y) => y.n - x.n),
    }))
    .sort((x, y) => y.index - x.index);
}

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const geo = (v: number[]) => Math.exp(mean(v.map(Math.log)));
