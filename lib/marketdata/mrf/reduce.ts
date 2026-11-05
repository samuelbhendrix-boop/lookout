import type { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { MrfScanner } from "./scan";
import { benchCodeMap, codeKey, type BenchCode } from "./codes";

/** One provider (TIN) × code × billing class × rate type: the compact chunk we keep from a rate file. */
export type RateRow = {
  code: string; codeType: string; billingClass: string; negotiatedType: string;
  tin: string; providerName: string | null; npiCount: number;
  n: number; min: number; median: number; max: number;
};
/** Provider-weighted distribution of one code across the whole network (each TIN counted once). */
export type RateSummary = {
  code: string; codeType: string; billingClass: string; negotiatedType: string;
  providers: number; p10: number; p25: number; p50: number; p75: number; p90: number;
};
export type ReduceResult = {
  meta: { reportingEntity: string | null; lastUpdated: string | null; version: string | null };
  summary: RateSummary[];
  stats: { compressedBytes: number; bytes: number; items: number; itemsKept: number; providerGroups: number; prices: number; skippedModifier: number; skippedExpired: number; oversize: number; seconds: number; rows: number; providers: number; keyProviders: number };
  rows: RateRow[];
};

type Price = { negotiated_type?: string; negotiated_rate?: number | string; billing_class?: string; billing_code_modifier?: string[]; expiration_date?: string };
type Group = { npi?: Array<number | string>; tin?: { type?: string; value?: string; business_name?: string } };
type RateEl = { provider_references?: number[]; provider_groups?: Group[]; negotiated_prices?: Price[] };

const KEPT_TYPES = new Set(["negotiated", "fee schedule", "derived", "per diem", "percentage"]);

/**
 * Stream a rate file (gzip or plain JSON) and reduce it to per-provider medians for a code basket.
 * Memory is bounded by provider_references (stored compactly) plus kept prices for basket codes only.
 */
export type ReduceOpts = {
  gzip: boolean;
  codes?: BenchCode[];
  today?: string;
  /** Always keep provider-level detail for these TINs (e.g. hospitals already tracked from other carriers). */
  tins?: Set<string>;
  /** Also keep the N largest TINs by NPI count. */
  topGroups?: number;
  onProgress?: (bytes: number, items: number) => void;
};

/**
 * Stream a rate file and reduce it to (1) a provider-weighted market summary per code and (2) provider-level
 * detail for key providers only: anything billing inpatient DRGs (hospitals), the largest groups, and opts.tins.
 * Prices are never expanded across a group's TINs in memory, which is what keeps multi-GB files under ~300 MB.
 */
export async function reduceRateFile(input: Readable, opts: ReduceOpts): Promise<ReduceResult> {
  const t0 = Date.now();
  const targets = benchCodeMap(opts.codes);
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  // TIN interning keeps provider_references cheap: group id → [tinIdx, npiCount, tinIdx, npiCount, …]
  const tinIds = new Map<string, number>();
  const tins: string[] = [];
  const names: Array<string | null> = [];
  const groups = new Map<number, number[]>();
  const tinIdx = (g: Group) => {
    const v = (g.tin?.value ?? "").replace(/\D/g, "");
    if (!v) return -1;
    const key = g.tin?.type === "npi" ? `npi:${v}` : v.padStart(9, "0");
    let id = tinIds.get(key);
    if (id === undefined) { id = tins.length; tinIds.set(key, id); tins.push(key); names.push(g.tin?.business_name?.trim() || null); }
    else if (!names[id] && g.tin?.business_name) names[id] = g.tin.business_name.trim();
    return id;
  };
  const packGroups = (gs: Group[] = []) => {
    const out: number[] = [];
    for (const g of gs) { const id = tinIdx(g); if (id >= 0) out.push(id, g.npi?.length ?? 0); }
    return out;
  };
  let inline = -1;

  // "code\tclass\ttype" → groupId → prices
  const acc = new Map<string, Map<number, number[]>>();
  let current: string | null = null;
  let prices = 0, skippedModifier = 0, skippedExpired = 0;

  const addRate = (el: RateEl) => {
    if (!current) return;
    let refs = el.provider_references ?? [];
    if (el.provider_groups?.length) { groups.set(inline, packGroups(el.provider_groups)); refs = [...refs, inline--]; }
    for (const p of el.negotiated_prices ?? []) {
      const type = (p.negotiated_type ?? "").toLowerCase();
      const rate = Number(p.negotiated_rate);
      if (!KEPT_TYPES.has(type) || !(rate > 0)) continue;
      if (p.billing_code_modifier?.some((m) => m && m.trim())) { skippedModifier++; continue; }
      if (p.expiration_date && p.expiration_date < today && !p.expiration_date.startsWith("9999")) { skippedExpired++; continue; }
      const cls = (p.billing_class ?? "").toLowerCase() || "unknown";
      const k = `${current}\t${cls}\t${type}`;
      let byGroup = acc.get(k);
      if (!byGroup) acc.set(k, (byGroup = new Map()));
      for (const r of refs) {
        let a = byGroup.get(r);
        if (!a) byGroup.set(r, (a = []));
        a.push(rate);
        prices++;
      }
    }
  };
  const headerKey = (text: string): string | null => {
    const code = /"billing_code"\s*:\s*"([^"]*)"/.exec(text)?.[1];
    const type = /"billing_code_type"\s*:\s*"([^"]*)"/.exec(text)?.[1];
    if (!code || !type) return null;
    const k = codeKey(type, code);
    return targets.has(k) ? k : null;
  };

  const scanner = new MrfScanner({
    providerRef(o) {
      const r = o as { provider_group_id?: number; provider_groups?: Group[] };
      if (typeof r.provider_group_id === "number") groups.set(r.provider_group_id, packGroups(r.provider_groups));
    },
    header(text) { current = headerKey(text); return current !== null; },
    rate(o) { addRate(o as RateEl); },
    whole(o) {
      const item = o as { billing_code?: string; billing_code_type?: string; negotiated_rates?: RateEl[] };
      current = item.billing_code && item.billing_code_type ? headerKey(JSON.stringify({ billing_code: item.billing_code, billing_code_type: item.billing_code_type })) : null;
      for (const el of item.negotiated_rates ?? []) addRate(el);
    },
  });

  let compressed = 0;
  input.on("data", (b: Buffer) => { compressed += b.length; });
  const stream = opts.gzip ? input.pipe(createGunzip()) : input;
  let last = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    scanner.write(chunk);
    if (opts.onProgress && scanner.bytes - last > 1e9) { last = scanner.bytes; opts.onProgress(scanner.bytes, scanner.items); }
  }

  // Key providers: hospitals (institutional inpatient DRG rates), largest groups, and requested TINs.
  const key = new Set<number>();
  const npiOf = new Int32Array(tins.length);
  for (const packed of groups.values()) for (let i = 0; i < packed.length; i += 2) npiOf[packed[i]] = Math.max(npiOf[packed[i]], packed[i + 1]);
  for (const [k, byGroup] of acc) {
    const [ck, cls] = k.split("\t");
    if (!ck.includes("DRG") || cls !== "institutional") continue;
    for (const gid of byGroup.keys()) { const p = groups.get(gid); if (p) for (let i = 0; i < p.length; i += 2) key.add(p[i]); }
  }
  [...npiOf.keys()].sort((a, b) => npiOf[b] - npiOf[a]).slice(0, opts.topGroups ?? 150).forEach((t) => key.add(t));
  if (opts.tins) for (const t of opts.tins) { const id = tinIds.get(t); if (id !== undefined) key.add(id); }

  // One code at a time: resolve groups → TINs transiently, emit summary + key-provider rows.
  const rows: RateRow[] = [];
  const summary: RateSummary[] = [];
  const everyone = new Set<number>();
  for (const [k, byGroup] of acc) {
    const [ck, cls, type] = k.split("\t");
    const [codeType, code] = ck.split("|");
    const perTin = new Map<number, number[]>();
    for (const [gid, vals] of byGroup) {
      const packed = groups.get(gid);
      if (!packed) continue;
      for (let i = 0; i < packed.length; i += 2) {
        const t = packed[i];
        let x = perTin.get(t);
        if (!x) perTin.set(t, (x = []));
        for (const v of vals) x.push(v);
      }
    }
    const medians: number[] = [];
    for (const [t, vals] of perTin) {
      everyone.add(t);
      const s = vals.sort((a, b) => a - b);
      const med = median(s);
      medians.push(med);
      if (key.has(t)) rows.push({ code, codeType, billingClass: cls, negotiatedType: type, tin: tins[t], providerName: names[t], npiCount: npiOf[t], n: s.length, min: s[0], median: med, max: s[s.length - 1] });
    }
    if (!medians.length) continue;
    medians.sort((a, b) => a - b);
    summary.push({ code, codeType, billingClass: cls, negotiatedType: type, providers: medians.length, p10: pct(medians, 0.1), p25: pct(medians, 0.25), p50: pct(medians, 0.5), p75: pct(medians, 0.75), p90: pct(medians, 0.9) });
  }
  const head = scanner.head;
  return {
    meta: {
      reportingEntity: /"reporting_entity_name"\s*:\s*"([^"]*)"/.exec(head)?.[1] ?? null,
      lastUpdated: /"last_updated_on"\s*:\s*"([^"]*)"/.exec(head)?.[1] ?? null,
      version: /"version"\s*:\s*"([^"]*)"/.exec(head)?.[1] ?? null,
    },
    stats: {
      compressedBytes: compressed, bytes: scanner.bytes, items: scanner.items, itemsKept: scanner.kept, providerGroups: groups.size, prices,
      skippedModifier, skippedExpired, oversize: scanner.oversize, seconds: (Date.now() - t0) / 1000, rows: rows.length, providers: everyone.size, keyProviders: key.size,
    },
    rows,
    summary,
  };
}

function median(s: number[]) {
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** Linear-interpolated percentile of a sorted array. */
export function pct(s: number[], q: number) {
  if (s.length === 1) return s[0];
  const x = (s.length - 1) * q, lo = Math.floor(x), hi = Math.ceil(x);
  return s[lo] + (s[hi] - s[lo]) * (x - lo);
}
