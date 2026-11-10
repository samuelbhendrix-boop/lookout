import { db } from "../../db";
import { BENCH_CODES, codeKey } from "./codes";
import { hospitalFor, irsName, medicareFor, providerState, type MedicareRef } from "./medicare";
import { MRF_REGISTRY } from "../tic";
import { RATE_SOURCES, type Skipped } from "./files";

/** Dollar-denominated rate types, in preference order when a provider has several. Percent-of-charges and per diems aren't comparable. */
export const DOLLAR_TYPES = ["negotiated", "fee schedule", "derived"];
const pref = (t: string) => DOLLAR_TYPES.indexOf(t);
const CATEGORY = new Map(BENCH_CODES.map((c) => [codeKey(c.type, c.code), c.category]));
export const codeInfo = (codeType: string, code: string) => BENCH_CODES.find((c) => codeKey(c.type, c.code) === codeKey(codeType, code));

type RowWhere = NonNullable<Parameters<typeof db.providerRate.findMany>[0]>["where"];

/**
 * Provider rates per network with delta storage resolved: a network with stats.baseId gets its base network's rows,
 * overridden by its own (tombstones, n = 0, remove a base price). Filters must be on row fields shared by base and delta.
 */
export async function effectiveRows(where: RowWhere) {
  const files = await db.rateFile.findMany({ where: { status: "ok" }, select: { id: true, stats: true } });
  const baseOf = new Map(files.map((f) => [f.id, ((f.stats ?? {}) as { baseId?: string }).baseId]));
  const rows = await db.providerRate.findMany({ where });
  const byFile = new Map<string, typeof rows>();
  for (const r of rows) (byFile.get(r.fileId) ?? byFile.set(r.fileId, []).get(r.fileId)!).push(r);
  const out: typeof rows = [];
  const key = (r: (typeof rows)[number]) => `${r.tin}|${r.codeType}|${r.code}|${r.billingClass}|${r.negotiatedType}`;
  for (const f of files) {
    const own = byFile.get(f.id) ?? [];
    const baseId = baseOf.get(f.id);
    if (!baseId) { for (const r of own) if (r.n > 0) out.push(r); continue; }
    const merged = new Map((byFile.get(baseId) ?? []).filter((r) => r.n > 0).map((r) => [key(r), { ...r, fileId: f.id }]));
    for (const r of own) { if (r.n > 0) merged.set(key(r), r); else merged.delete(key(r)); }
    out.push(...merged.values());
  }
  return out;
}

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
/** A published price this far from Medicare is almost certainly a source-data error (e.g. one hospital at $260K for every DRG). */
export const SUSPECT = { high: 10, low: 0.2 };
export const isSuspect = (rate: number, medicare: number | null | undefined) => !!medicare && (rate / medicare > SUSPECT.high || rate / medicare < SUSPECT.low);

export type CarrierRate = { median: number; min: number; max: number; type: string; networks: Array<{ network: string; median: number; type: string }>; prev?: number };

/**
 * One code, one billing class, one carrier per column. A provider's carrier rate is the median across that carrier's
 * networks (each network's preferred dollar type); the per-network values travel along for tooltips and CSV.
 * `state` limits providers to that state (matched hospital's state, else EIN prefix); "all" keeps everyone.
 */
export async function codeBenchmark(codeType: string, code: string, billingClass: string, state = "all", fileIds?: string[]) {
  // fileIds: only these networks count (the Rates page's network filter); default every network.
  const files = (await rateFiles()).filter((f) => f.status === "ok" && (!fileIds?.length || fileIds.includes(f.id)));
  const fileById = new Map(files.map((f) => [f.id, f]));
  const [sums, rows] = await Promise.all([
    db.rateSummary.findMany({ where: { codeType, code, billingClass, negotiatedType: { in: DOLLAR_TYPES } } }),
    effectiveRows({ codeType, code, billingClass, negotiatedType: { in: DOLLAR_TYPES } }),
  ]);
  // Network summary per carrier: the network covering the most providers for this code.
  const summary = new Map<string, (typeof sums)[number] & { network: string; networks: number }>();
  const netCount = new Map<string, Set<string>>();
  for (const s of sums) {
    const f = fileById.get(s.fileId);
    if (!f) continue;
    (netCount.get(f.carrier) ?? netCount.set(f.carrier, new Set()).get(f.carrier)!).add(f.id);
    const cur = summary.get(f.carrier);
    if (!cur || s.providers > cur.providers) summary.set(f.carrier, { ...s, network: f.network, networks: 0 });
  }
  for (const [c, x] of summary) x.networks = netCount.get(c)?.size ?? 1;

  const best = new Map<string, Pick>();
  for (const r of rows) {
    const k = `${r.fileId}\t${r.tin}`;
    const cur = best.get(k);
    if (!cur || pref(r.negotiatedType) < pref(cur.negotiatedType)) best.set(k, r);
  }
  type Acc = { tin: string; name: string | null; npiCount: number; state: string | null; byCarrier: Map<string, Array<Pick & { network: string }>> };
  const byTin = new Map<string, Acc>();
  for (const p of best.values()) {
    const f = fileById.get(p.fileId);
    if (!f) continue;
    let x = byTin.get(p.tin);
    if (!x) byTin.set(p.tin, (x = { tin: p.tin, name: p.providerName, npiCount: p.npiCount, state: providerState(p.tin), byCarrier: new Map() }));
    (x.byCarrier.get(f.carrier) ?? x.byCarrier.set(f.carrier, []).get(f.carrier)!).push({ ...p, network: f.network });
    x.npiCount = Math.max(x.npiCount, p.npiCount);
    if (!x.name && p.providerName) x.name = p.providerName;
  }
  // Last month's carrier-level rate, from history, for the month-over-month marker.
  const prevMonth = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const prevRows = await db.rateHistory.findMany({ where: { codeType, code, billingClass, month: prevMonth }, select: { carrier: true, tin: true, median: true } });
  const prev = new Map(prevRows.map((r) => [`${r.carrier}|${r.tin}`, r.median]));
  const providers = [...byTin.values()]
    .filter((p) => state === "all" || p.state === state)
    .map((p) => {
      const rates: Record<string, CarrierRate> = {};
      for (const [c, list] of p.byCarrier) {
        const med = medianOf(list.map((l) => l.median))!;
        rates[c] = { median: med, min: Math.min(...list.map((l) => l.min)), max: Math.max(...list.map((l) => l.max)), type: list[0].negotiatedType, networks: list.map((l) => ({ network: l.network, median: l.median, type: l.negotiatedType })), prev: prev.get(`${c}|${p.tin}`) };
      }
      const v = Object.values(rates).map((r) => r.median);
      return { tin: p.tin, name: p.name ?? irsName(p.tin), npiCount: p.npiCount, state: p.state, rates, medicare: medicareFor(codeType, code, billingClass, p.tin), carriers: v.length, spread: v.length > 1 ? Math.max(...v) / Math.min(...v) : null, top: Math.max(...v) };
    })
    .sort((a, b) => b.carriers - a.carriers || b.top - a.top);
  // Carrier columns: anyone with a provider rate in view, or a network summary when no state filter.
  const carrierIds = [...new Set([...providers.flatMap((p) => Object.keys(p.rates)), ...(state === "all" ? summary.keys() : [])])];
  const carriers = carrierIds
    .map((c) => {
      const fs = files.filter((f) => f.carrier === c);
      return { carrier: c, carrierName: fs[0]?.carrierName ?? c, networks: fs.length, summary: summary.get(c) ?? null, providers: providers.filter((p) => p.rates[c]).length };
    })
    .sort((a, b) => b.providers - a.providers);
  return { files, carriers, providers, medicare: medicareFor(codeType, code, billingClass, undefined, state === "all" ? "MA" : state) };
}

/**
 * Carrier price index: for every (service, billing class, provider) priced by 2+ carriers, each carrier's rate ÷ the
 * geometric mean across carriers; a carrier's index is the geometric mean of those ratios. 1.20 = pays 20% above peers
 * for the same service at the same provider. Networks of one carrier are averaged first.
 */
type IndexValue = Awaited<ReturnType<typeof computeCarrierIndex>>;
type Suspects = Array<{ carrierName: string; count: number; examples: string[] }>;
const INDEX_ID = "cache:carrier-index";

/**
 * The carrier index scans every rate, so it's computed in the import process (refreshCarrierIndex, after each rate import)
 * and stored; the web process only reads it — computing it there pushed the server past 500 MB.
 */
export async function refreshCarrierIndex() {
  const suspects: Suspects = [];
  const value = await computeCarrierIndex(suspects);
  const data = { carrier: "_cache", carrierName: "_cache", network: "carrier index", url: "", status: "cache", stats: JSON.parse(JSON.stringify({ value, suspects })), processedAt: new Date() };
  await db.rateFile.upsert({ where: { id: INDEX_ID }, create: { id: INDEX_ID, ...data }, update: data });
  // Hospital leverage (% of Medicare by hospital × carrier) is built from the history just written.
  const { refreshLeverage } = await import("./leverage");
  await refreshLeverage();
  return value;
}
async function readIndex() {
  const row = await db.rateFile.findUnique({ where: { id: INDEX_ID } });
  return (row?.stats ?? { value: [], suspects: [] }) as unknown as { value: IndexValue; suspects: Suspects };
}
export async function carrierIndex() { return (await readIndex()).value; }
/** Prices excluded as suspect by the last index computation. */
export async function suspectPrices() { return (await readIndex()).suspects; }

/**
 * One service at a time, so memory stays small even with dozens of networks per carrier.
 */
async function computeCarrierIndex(suspectsOut: Suspects = []) {
  const files = await db.rateFile.findMany({ where: { status: "ok" }, select: { id: true, carrier: true, carrierName: true } });
  const fileCarrier = new Map(files.map((f) => [f.id, f]));
  const services = await db.$queryRaw<Array<{ codeType: string; code: string }>>`
    SELECT DISTINCT "codeType", code FROM "ProviderRate" WHERE n > 0 AND "billingClass" IN ('institutional', 'professional')`;
  const acc = new Map<string, { all: number[]; cat: Map<string, number[]>; providers: Set<string> }>();
  const pctAcc = new Map<string, { all: number[]; cat: Map<string, number[]> }>();
  const suspects = new Map<string, { carrierName: string; count: number; examples: string[] }>();
  // Monthly history of carrier-level rates (basis for rate- and network-change events). Rewritten each refresh.
  const month = new Date().toISOString().slice(0, 7);
  // Written one service at a time (not held in memory): the month is cleared first, then refilled.
  let history: Array<{ carrier: string; carrierName: string; codeType: string; code: string; billingClass: string; tin: string; month: string; median: number }> = [];
  await db.rateHistory.deleteMany({ where: { month } });
  const nameOf = new Map(files.map((f) => [f.carrier, f.carrierName]));
  for (const svc of services) {
    if (history.length) { await db.rateHistory.createMany({ data: history, skipDuplicates: true }); history = []; }
    const rows = await effectiveRows({ codeType: svc.codeType, code: svc.code, negotiatedType: { in: DOLLAR_TYPES }, billingClass: { in: ["institutional", "professional"] } });
    // network × class × provider → preferred type
    const best = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const k = `${r.fileId}\t${r.billingClass}\t${r.tin}`;
      const cur = best.get(k);
      if (!cur || pref(r.negotiatedType) < pref(cur.negotiatedType)) best.set(k, r);
    }
    // class × provider → carrier → values (one per network)
    const cells = new Map<string, Map<string, number[]>>();
    for (const r of best.values()) {
      const f = fileCarrier.get(r.fileId);
      if (!f) continue;
      const k = `${r.billingClass}\t${r.tin}`;
      let m = cells.get(k);
      if (!m) cells.set(k, (m = new Map()));
      let vals = m.get(f.carrier);
      if (!vals) m.set(f.carrier, (vals = []));
      vals.push(r.median);
    }
    const ck = `${svc.codeType}|${svc.code}`;
    const cat = CATEGORY.get(ck) ?? "Other";
    for (const [k, m] of cells) {
      const [cls, tin] = k.split("\t");
      for (const [c, x] of m) history.push({ carrier: c, carrierName: nameOf.get(c) ?? c, codeType: svc.codeType, code: svc.code, billingClass: cls, tin, month, median: medianOf(x)! });
      const mc = medicareFor(svc.codeType, svc.code, cls, tin);
      const vals = [...m.entries()].map(([c, x]) => [c, geo(x)] as const).filter(([c, x]) => {
        if (!isSuspect(x, mc.amount)) return true;
        const sx = suspects.get(c) ?? { carrierName: files.find((f) => f.carrier === c)?.carrierName ?? c, count: 0, examples: [] };
        sx.count++;
        if (sx.examples.length < 3) sx.examples.push(`${irsName(tin) ?? tin} ${svc.codeType} ${svc.code}: $${Math.round(x).toLocaleString()} vs Medicare $${Math.round(mc.amount!).toLocaleString()}`);
        suspects.set(c, sx);
        return false;
      });
      if (m.size >= 2) {
        const g = geo(vals.map((x) => x[1]));
        for (const [c, x] of vals) {
          let a = acc.get(c);
          if (!a) acc.set(c, (a = { all: [], cat: new Map(), providers: new Set() }));
          const lr = Math.log(x / g);
          a.all.push(lr);
          a.providers.add(tin);
          (a.cat.get(cat) ?? a.cat.set(cat, []).get(cat)!).push(lr);
        }
      }
      // % of Medicare: every provider × service the carrier prices (not just overlaps).
      if (!mc.amount) continue;
      for (const [c, x] of vals) {
        let a = pctAcc.get(c);
        if (!a) pctAcc.set(c, (a = { all: [], cat: new Map() }));
        a.all.push(x / mc.amount);
        (a.cat.get(cat) ?? a.cat.set(cat, []).get(cat)!).push(x / mc.amount);
      }
    }
  }
  if (history.length) await db.rateHistory.createMany({ data: history, skipDuplicates: true });
  // Keep 13 months.
  const cutoff = new Date(); cutoff.setUTCMonth(cutoff.getUTCMonth() - 13);
  await db.rateHistory.deleteMany({ where: { month: { lt: cutoff.toISOString().slice(0, 7) } } });
  const name = new Map(files.map((f) => [f.carrier, f.carrierName]));
  suspectsOut.push(...suspects.values());
  return [...new Set([...acc.keys(), ...pctAcc.keys()])]
    .map((carrier) => {
      const a = acc.get(carrier) ?? { all: [], cat: new Map<string, number[]>(), providers: new Set<string>() };
      const cats = new Set([...a.cat.keys(), ...(pctAcc.get(carrier)?.cat.keys() ?? [])]);
      return {
        carrier,
        carrierName: name.get(carrier) ?? carrier,
        index: a.all.length ? Math.exp(mean(a.all)) : null,
        comparisons: a.all.length,
        providers: a.providers.size,
        byCategory: [...cats].map((category) => { const v = a.cat.get(category) ?? []; return { category, index: v.length ? Math.exp(mean(v)) : null, n: v.length, pctMedicare: medianOf(pctAcc.get(carrier)?.cat.get(category) ?? []) }; }).sort((x, y) => y.n - x.n),
        pctMedicare: medianOf(pctAcc.get(carrier)?.all ?? []),
        pctMedicareN: pctAcc.get(carrier)?.all.length ?? 0,
      };
    })
    .sort((x, y) => (y.index ?? 0) - (x.index ?? 0));
}

const medianOf = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const geo = (v: number[]) => Math.exp(mean(v.map(Math.log)));

/**
 * Everything the rate benchmark leaves out, with counts, so the page can say so plainly.
 */
export async function rateGaps() {
  const all = await db.rateFile.findMany();
  const ok = all.filter((f) => f.status === "ok");
  const okCarriers = [...new Set([...RATE_SOURCES.map((r) => r.id), ...ok.map((f) => f.carrier)])];
  const isCovered = (id: string) => okCarriers.some((c) => c === id || c.startsWith(`${id}_`));
  const carriersNotCovered = MRF_REGISTRY.filter((r) => !isCovered(r.id)).map((r) => ({
    carrier: r.carrier,
    reason: r.id === "cigna" || r.id === "anthem" || r.id === "aetna"
      ? "National rate files (tens of GB each, no New England-only file); not yet reduced"
      : r.adapter ? "Rate files not yet wired into the monthly reduction" : `Not automated — ${(r.note ?? r.method).replace(/\.$/, "")}. Any of its files can be reduced by hand with npm run mrf:reduce`,
  }));
  const skippedFiles = all.filter((f) => f.status === "skipped").flatMap((f) => ((f.stats as { skipped?: Array<Skipped & { carrierName?: string }> } | null)?.skipped ?? []).map((s) => ({ ...s, carrier: s.carrierName ?? f.carrierName })));
  const duplicates = all.filter((f) => f.status === "duplicate").map((f) => ({ carrier: f.carrierName, network: f.network, error: f.error }));
  const failed = all.filter((f) => f.status === "failed").map((f) => ({ carrier: f.carrierName, network: f.network, error: f.error }));
  // Snapshots the monthly refresh couldn't update (e.g. the Blues, whose table of contents only browsers can fetch).
  const staleCutoff = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
  const stale = ok.filter((f) => (f.stats as { snapshot?: number } | null)?.snapshot && f.lastUpdated && f.lastUpdated < staleCutoff)
    .map((f) => ({ carrier: f.carrierName, network: f.network, lastUpdated: f.lastUpdated! }));
  const pctProviders = await db.rateSummary.groupBy({ by: ["fileId"], where: { negotiatedType: "percentage" }, _max: { providers: true } });
  const perDiem = await db.rateSummary.groupBy({ by: ["fileId"], where: { negotiatedType: "per diem" }, _max: { providers: true } });
  const perFile = ok.map((f) => {
    const s = (f.stats ?? {}) as Record<string, number>;
    return {
      file: `${f.carrierName} · ${f.network}`,
      snapshot: !!s.snapshot,
      codesOutsideBasket: s.items && s.itemsKept != null ? s.items - s.itemsKept : null,
      modifierPrices: s.skippedModifier ?? null,
      expiredPrices: s.skippedExpired ?? null,
      providersSummaryOnly: s.providers && s.keyProviders != null ? Math.max(0, s.providers - s.keyProviders) : null,
      percentOfChargeProviders: pctProviders.find((p) => p.fileId === f.id)?._max.providers ?? 0,
      perDiemProviders: perDiem.find((p) => p.fileId === f.id)?._max.providers ?? 0,
    };
  });
  // Hospitals (DRG billers) without a Medicare match, and services with no Medicare amount.
  const drgTins = await db.$queryRaw<Array<{ tin: string; providerName: string | null }>>`
    SELECT tin, max("providerName") FILTER (WHERE "providerName" !~* '^unknown$') "providerName" FROM "ProviderRate"
    WHERE "codeType" IN ('MS-DRG', 'APR-DRG') AND "billingClass" = 'institutional' AND n > 0 GROUP BY tin`;
  const unmatchedHospitals = drgTins
    .map((t) => ({ tin: t.tin, name: t.providerName ?? irsName(t.tin), m: hospitalFor(t.tin) }))
    .filter((t) => !t.m || "exempt" in t.m)
    .map((t) => ({ tin: t.tin, name: t.name, reason: t.m && "exempt" in t.m ? t.m.exempt : !t.name || /^unknown$/i.test(t.name) ? "Rate file publishes no provider name for this TIN, so it can't be matched to a Medicare hospital (statewide Medicare average used)" : "No reviewed TIN → Medicare hospital match yet (statewide Medicare average used)" }));
  const noMedicare: Array<{ service: string; billingClass: string; reason: string }> = [];
  for (const c of BENCH_CODES) for (const cls of c.type === "CPT" ? ["professional", "institutional"] : ["institutional"]) {
    const m = medicareFor(c.type, c.code, cls);
    if (!m.amount) noMedicare.push({ service: c.label, billingClass: cls, reason: (m as { reason: string }).reason });
  }
  // Provider × service cells priced by only one carrier (excluded from the cross-carrier index).
  const single = await db.$queryRaw<Array<{ n: bigint; total: bigint }>>`
    WITH cells AS (
      SELECT p."codeType", p.code, p."billingClass", p.tin, count(DISTINCT f.carrier) c
      FROM "ProviderRate" p JOIN "RateFile" f ON f.id = p."fileId"
      WHERE f.status = 'ok' AND p.n > 0 AND p."negotiatedType" IN ('negotiated', 'fee schedule', 'derived')
      GROUP BY 1, 2, 3, 4)
    SELECT count(*) FILTER (WHERE c = 1) n, count(*) total FROM cells`;
  // Carriers whose reduced networks contain no prices at all for a whole category (e.g. no inpatient DRGs).
  const have = await db.$queryRaw<Array<{ carrier: string; carrierName: string; inpatient: boolean; facility: boolean; professional: boolean }>>`
    SELECT f.carrier, max(f."carrierName") "carrierName",
      bool_or(p."codeType" LIKE '%DRG') inpatient,
      bool_or(p."codeType" = 'CPT' AND p."billingClass" = 'institutional') facility,
      bool_or(p."billingClass" = 'professional') professional
    FROM "ProviderRate" p JOIN "RateFile" f ON f.id = p."fileId"
    WHERE f.status = 'ok' AND p.n > 0 AND p."negotiatedType" IN ('negotiated', 'fee schedule', 'derived') GROUP BY f.carrier`;
  const missingCategories = have.flatMap((h) => [
    ...(h.inpatient ? [] : [`${h.carrierName}: no inpatient (DRG) dollar prices in any reduced network`]),
    ...(h.facility ? [] : [`${h.carrierName}: no hospital outpatient (facility) dollar prices`]),
    ...(h.professional ? [] : [`${h.carrierName}: no professional (physician) dollar prices`]),
  ]);
  return {
    carriersNotCovered, skippedFiles, failed, stale, duplicates, perFile, missingCategories, unmatchedHospitals, noMedicare,
    singleCarrierCells: Number(single[0]?.n ?? 0), totalCells: Number(single[0]?.total ?? 0),
  };
}
