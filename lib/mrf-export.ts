import { Prisma } from "@prisma/client";
import { db } from "./db";
import { benchCodeMap, codeKey } from "./marketdata/mrf/codes";

/**
 * Everything the site keeps from payer and hospital machine-readable price files, as plain tables for download.
 * Each table is read from the database in pages and streamed, so a few hundred thousand rows never sit in memory.
 */
type Cell = string | number | null;
type Row = Record<string, unknown>;
export type MrfTable = {
  key: string; title: string; holds: string; source: string;
  count: () => Promise<number>;
  /** One page of raw rows, in a stable order. */
  page: (limit: number, offset: number) => Promise<Row[]>;
  cols: Array<{ h: string; get: (r: Row) => Cell }>;
};

const codes = benchCodeMap();
const svc = (r: Row) => codes.get(codeKey(String(r.codeType), String(r.code)));
const s = (k: string) => (r: Row): Cell => (r[k] == null ? null : String(r[k]));
const n = (k: string) => (r: Row): Cell => (typeof r[k] === "number" ? (r[k] as number) : r[k] == null ? null : Number(r[k]));
const d = (k: string) => (r: Row): Cell => (r[k] instanceof Date ? (r[k] as Date).toISOString().slice(0, 10) : r[k] == null ? null : String(r[k]));
const CODE = [{ h: "Code type", get: s("codeType") }, { h: "Code", get: s("code") }, { h: "Service", get: (r: Row) => svc(r)?.label ?? null }, { h: "Service category", get: (r: Row) => svc(r)?.category ?? null }];
const q = <T = Row>(sql: Prisma.Sql) => db.$queryRaw<T[]>(sql);
const REAL = Prisma.sql`f.status not in ('cache')`;

let nameCache: { at: number; m: Map<string, string> } | null = null;
/** Provider names by tax ID, from the provider-rate table (the history table keeps only the ID). */
async function providerNames(): Promise<Map<string, string>> {
  if (nameCache && Date.now() - nameCache.at < 10 * 60_000) return nameCache.m;
  const rows = await q<{ tin: string; name: string }>(Prisma.sql`select tin, max("providerName") name from "ProviderRate" where "providerName" is not null group by tin`);
  nameCache = { at: Date.now(), m: new Map(rows.map((r) => [r.tin, r.name])) };
  return nameCache.m;
}

export const MRF_TABLES: MrfTable[] = [
  {
    key: "carrier-rates-by-state", title: "Carrier rates by state", holds: "What each carrier pays New England providers for each service, by state and billing class: the number of provider groups and the 25th percentile, median and 75th percentile of their negotiated rates. One row per month, carrier, state, service and billing class.",
    source: "Monthly extract of carriers' Transparency in Coverage in-network files. One median per provider group first, then the spread across groups.",
    count: () => db.marketCodeRate.count(),
    page: (limit, offset) => q(Prisma.sql`select month, "carrierName", state, "codeType", code, "billingClass", providers, p25, median, p75 from "MarketCodeRate" order by id limit ${limit} offset ${offset}`),
    cols: [{ h: "Month", get: s("month") }, { h: "Carrier", get: s("carrierName") }, { h: "State", get: s("state") }, ...CODE, { h: "Billing class", get: s("billingClass") }, { h: "Provider groups", get: n("providers") }, { h: "25th percentile rate", get: n("p25") }, { h: "Median rate", get: n("median") }, { h: "75th percentile rate", get: n("p75") }],
  },
  {
    key: "provider-rates", title: "Rates at key providers", holds: "The negotiated rate each carrier network pays a named hospital or large provider group for each service: lowest, median and highest rate found, and how many rates and clinicians sit behind it. One row per carrier network, provider (tax ID), service, billing class and rate type.",
    source: "Carriers' in-network rate files, reduced to hospitals and large groups in New England.",
    count: () => db.providerRate.count(),
    page: (limit, offset) => q(Prisma.sql`select f."carrierName", f.network, f."lastUpdated", p."codeType", p.code, p."billingClass", p."negotiatedType", p.tin, p."providerName", p."npiCount", p.n, p.min, p.median, p.max from "ProviderRate" p join "RateFile" f on f.id = p."fileId" order by p.id limit ${limit} offset ${offset}`),
    cols: [{ h: "Carrier", get: s("carrierName") }, { h: "Network", get: s("network") }, { h: "Provider", get: s("providerName") }, { h: "Provider tax ID", get: s("tin") }, ...CODE, { h: "Billing class", get: s("billingClass") }, { h: "Rate type", get: s("negotiatedType") }, { h: "Lowest rate", get: n("min") }, { h: "Median rate", get: n("median") }, { h: "Highest rate", get: n("max") }, { h: "Rates found", get: n("n") }, { h: "Clinicians (NPIs)", get: n("npiCount") }, { h: "File last updated", get: s("lastUpdated") }],
  },
  {
    key: "network-rate-spread", title: "Network-wide rate spread", holds: "For each carrier network and service, the spread of negotiated rates across every provider in the file: 10th, 25th, 50th, 75th and 90th percentiles. One row per carrier network, service, billing class and rate type.",
    source: "Carriers' in-network rate files; each provider tax ID counted once.",
    count: () => db.rateSummary.count(),
    page: (limit, offset) => q(Prisma.sql`select f."carrierName", f.network, r."codeType", r.code, r."billingClass", r."negotiatedType", r.providers, r.p10, r.p25, r.p50, r.p75, r.p90 from "RateSummary" r join "RateFile" f on f.id = r."fileId" order by r.id limit ${limit} offset ${offset}`),
    cols: [{ h: "Carrier", get: s("carrierName") }, { h: "Network", get: s("network") }, ...CODE, { h: "Billing class", get: s("billingClass") }, { h: "Rate type", get: s("negotiatedType") }, { h: "Providers", get: n("providers") }, { h: "10th percentile", get: n("p10") }, { h: "25th percentile", get: n("p25") }, { h: "Median", get: n("p50") }, { h: "75th percentile", get: n("p75") }, { h: "90th percentile", get: n("p90") }],
  },
  {
    key: "rate-history", title: "Rate history by provider", holds: "The median negotiated rate each carrier paid each key provider for each service, month by month. This is what rate-change and network-change alerts are detected from. One row per month, carrier, provider (tax ID), service and billing class.",
    source: "Each month's carrier rate files, kept as one median per carrier, provider and service.",
    count: () => db.rateHistory.count(),
    page: async (limit, offset) => {
      const names = await providerNames();
      const rows = await q(Prisma.sql`select month, "carrierName", tin, "codeType", code, "billingClass", median from "RateHistory" order by carrier, "codeType", code, "billingClass", tin, month limit ${limit} offset ${offset}`);
      return rows.map((r) => ({ ...r, providerName: names.get(String(r.tin)) ?? null }));
    },
    cols: [{ h: "Month", get: s("month") }, { h: "Carrier", get: s("carrierName") }, { h: "Provider", get: s("providerName") }, { h: "Provider tax ID", get: s("tin") }, ...CODE, { h: "Billing class", get: s("billingClass") }, { h: "Median rate", get: n("median") }],
  },
  {
    key: "hospital-rates", title: "Hospital-published rates", holds: "The rate each hospital says it has negotiated with each payer and plan for each service, in dollars or as a percentage of charges, with the payment method. One row per hospital, payer, plan, service and setting.",
    source: "Hospitals' own price transparency files (standard charges). Carrier and product are Payersight's reading of the payer and plan names; blank where not recognised.",
    count: () => db.hospitalRate.count(),
    page: (limit, offset) => q(Prisma.sql`select hospital, state, tin, "codeType", code, setting, payer, plan, carrier, product, dollar, percentage, methodology from "HospitalRate" order by id limit ${limit} offset ${offset}`),
    cols: [{ h: "Hospital", get: s("hospital") }, { h: "State", get: s("state") }, { h: "Hospital tax ID", get: s("tin") }, ...CODE, { h: "Setting", get: s("setting") }, { h: "Payer as published", get: s("payer") }, { h: "Plan as published", get: s("plan") }, { h: "Carrier", get: s("carrier") }, { h: "Product", get: s("product") }, { h: "Negotiated dollar rate", get: n("dollar") }, { h: "Negotiated percent of charges", get: n("percentage") }, { h: "Payment method", get: s("methodology") }],
  },
  {
    key: "carrier-files", title: "Carrier files read", holds: "Every carrier rate file the site has tried to read: the network it covers, where it came from, whether it was read, and when.",
    source: "Payersight's file log.",
    count: async () => Number((await q<{ c: bigint }>(Prisma.sql`select count(*) c from "RateFile" f where ${REAL}`))[0].c),
    page: (limit, offset) => q(Prisma.sql`select f."carrierName", f.network, f.status, f."reportingEntity", f."lastUpdated", f."processedAt", f.url, f.error from "RateFile" f where ${REAL} order by f.id limit ${limit} offset ${offset}`),
    cols: [{ h: "Carrier", get: s("carrierName") }, { h: "Network", get: s("network") }, { h: "Status", get: s("status") }, { h: "Reporting entity", get: s("reportingEntity") }, { h: "File last updated", get: s("lastUpdated") }, { h: "Read on", get: d("processedAt") }, { h: "File link", get: s("url") }, { h: "Problem", get: s("error") }],
  },
  {
    key: "hospital-files", title: "Hospital files read", holds: "Every hospital price file the site has tried to read: the hospital, where the file came from, whether it was read, and how many rows were kept.",
    source: "Payersight's file log.",
    count: () => db.hospitalFile.count(),
    page: (limit, offset) => q(Prisma.sql`select hospital, state, tin, status, rows, "lastUpdated", "processedAt", url, error from "HospitalFile" order by id limit ${limit} offset ${offset}`),
    cols: [{ h: "Hospital", get: s("hospital") }, { h: "State", get: s("state") }, { h: "Hospital tax ID", get: s("tin") }, { h: "Status", get: s("status") }, { h: "Rows kept", get: n("rows") }, { h: "File last updated", get: s("lastUpdated") }, { h: "Read on", get: d("processedAt") }, { h: "File link", get: s("url") }, { h: "Problem", get: s("error") }],
  },
];
export const mrfTable = (key: string) => MRF_TABLES.find((t) => t.key === key) ?? null;
const PAGE = 20_000;

/** A table's rows as arrays of cells, page by page. */
export async function* tableRows(t: MrfTable): AsyncGenerator<Cell[]> {
  for (let offset = 0; ; offset += PAGE) {
    const rows = await t.page(PAGE, offset);
    for (const r of rows) yield t.cols.map((c) => c.get(r));
    if (rows.length < PAGE) return;
  }
}

const esc = (v: Cell) => { if (v == null) return ""; const x = String(v); return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
/** One table as a CSV stream (with a byte-order mark so Excel reads accents correctly). */
export function csvStream(t: MrfTable): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const it = tableRows(t);
  let started = false;
  return new ReadableStream({
    async pull(ctrl) {
      if (!started) { started = true; ctrl.enqueue(enc.encode(`﻿${t.cols.map((c) => esc(c.h)).join(",")}\r\n`)); return; }
      let chunk = "";
      for (let i = 0; i < 2000; i++) { const r = await it.next(); if (r.done) { if (chunk) ctrl.enqueue(enc.encode(chunk)); ctrl.close(); return; } chunk += `${r.value.map(esc).join(",")}\r\n`; }
      ctrl.enqueue(enc.encode(chunk));
    },
  });
}

export const stamp = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
