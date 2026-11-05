import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../../db";
import type { RateRow } from "./reduce";
import { reduceSource } from "./source";

/**
 * Regional carriers whose negotiated-rate files are small enough to reduce monthly on a small server.
 * File names change every month, so each source discovers its current files from the carrier's own index.
 * National carriers (UHC, Cigna, Aetna) publish 10–100+ GB per file: reduce those ad hoc with `npm run mrf:reduce`.
 */
export type Skipped = { reason: string; files: number; example: string };
type Discovered = { files: Array<{ network: string; url: string }>; skipped: Skipped[] };
type RateSource = { carrier: string; carrierName: string; discover(): Promise<Discovered> };

/** Groups files we chose not to reduce by reason, so the UI can say exactly what was left out. */
function skipList(items: Array<{ url: string; reason: string }>): Skipped[] {
  const m = new Map<string, Skipped>();
  for (const it of items) {
    const x = m.get(it.reason) ?? { reason: it.reason, files: 0, example: it.url };
    x.files++;
    m.set(it.reason, x);
  }
  return [...m.values()];
}

const UA = { "User-Agent": "Mozilla/5.0 (compatible; LookoutBot; +https://github.com/samuelbhendrix-boop/lookout)" };
async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`);
  return JSON.parse((await res.text()).replace(/^﻿/, "")) as T;
}
type Toc = { reporting_structure?: Array<{ in_network_files?: Array<{ location: string; description?: string }> }> };
const filesOf = (toc: Toc) => (toc.reporting_structure ?? []).flatMap((s) => s.in_network_files ?? []);

export const RATE_SOURCES: RateSource[] = [
  {
    carrier: "mgb",
    carrierName: "Mass General Brigham Health Plan",
    async discover() {
      const toc = await json<Toc>("https://massgeneralbrighamhealthplan.org/pricetransparency/MRF/Base");
      const pick = new Map<string, string>();
      const skipped: Array<{ url: string; reason: string }> = [];
      for (const f of new Map(filesOf(toc).map((x) => [x.location, x])).values()) {
        const m = /\/INN\/AWHP\/INN_(COMMERCIAL_HMO|COMMERCIAL_PPO)_[\d-]+\.json\.gz$/.exec(f.location);
        if (m) pick.set(m[1] === "COMMERCIAL_HMO" ? "Commercial HMO" : "Commercial PPO", f.location);
        else skipped.push({ url: f.location, reason: /\/CAP\//.test(f.location) ? "Capitation files — per-member payments, no per-service prices to compare"
          : /\/Vendors\//.test(f.location) ? "Behavioral health vendor network (Optum) — separate contracts, not reduced"
          : /multiplan/i.test(f.location) ? "Rented MultiPlan PHCS network for out-of-area members — zip of national rates, not reduced"
          : /uhc\.com/.test(f.location) ? "Rented UnitedHealthcare Options PPO for out-of-area members — national 15 GB files; see UnitedHealthcare snapshot"
          : /\/INN\/AWHP\//.test(f.location) ? "Other MGB networks (ASO, Select, Allies, Value) — not reduced to keep the monthly run small"
          : "Other file — not reduced" });
      }
      return { files: [...pick].map(([network, url]) => ({ network, url })), skipped: skipList(skipped) };
    },
  },
  {
    carrier: "harvard_pilgrim",
    carrierName: "Harvard Pilgrim Health Care",
    async discover() {
      // The plan list links one index per employer group; the most-referenced HPHC-hosted files are the core networks.
      const html = await (await fetch("https://eusprdtransparencymrfp32.z13.web.core.windows.net/hphc", { headers: UA, signal: AbortSignal.timeout(60_000) })).text();
      const indexes = [...new Set(html.match(/https:\/\/eusprdtransparencymrfp32\.blob\.core\.windows\.net\/hphc\/[^'"\s]+_index\.json/g) ?? [])];
      const counts = new Map<string, number>();
      const others = new Set<string>();
      let badIndexes = 0;
      for (const u of indexes) {
        try {
          for (const f of filesOf(await json<Toc>(u))) {
            if (/eusprdtransparencymrfp32\.blob\.core\.windows\.net\/hphc\/.*_A\d+-FS_in-network-rates\.zip$/.test(f.location)) counts.set(f.location, (counts.get(f.location) ?? 0) + 1);
            else others.add(f.location);
          }
        } catch { badIndexes++; }
      }
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const skipped = [
        ...ranked.slice(2).map(([url, n]) => ({ url, reason: `Other Harvard Pilgrim fee-schedule networks (each used by ≤${ranked[2]?.[1] ?? n} employer groups) — only the two most-used are reduced` })),
        ...[...others].map((url) => ({ url, reason: /Dental/i.test(url) ? "Dental networks — outside the medical benchmark"
          : /uhc\.com/.test(url) ? "Rented UnitedHealthcare networks for out-of-area members — national 15 GB files; see UnitedHealthcare snapshot"
          : /-P\d_/.test(url) ? "Harvard Pilgrim provider-tier (P1) networks — not reduced" : "Other file — not reduced" })),
      ];
      if (badIndexes) skipped.push(...Array.from({ length: badIndexes }, () => ({ url: "", reason: "Employer index files that failed to download this month" })));
      return { files: ranked.slice(0, 2).map(([url, n]) => ({ network: `Network ${/_(A\d+)-FS_/.exec(url)![1]} (${n} groups)`, url })), skipped: skipList(skipped) };
    },
  },
];

/** Reduce every regional rate file and replace its stored chunk. Returns rows written. */
export async function importRates(): Promise<number> {
  // Keep detail for providers already tracked anywhere, so every carrier reports the same hospitals.
  const tracked = new Set((await db.providerRate.findMany({ select: { tin: true }, distinct: ["tin"] })).map((r) => r.tin));
  let written = 0;
  let failures = 0;
  for (const src of RATE_SOURCES) {
    let files: Array<{ network: string; url: string }> = [];
    try {
      const d = await src.discover();
      files = d.files;
      if (!files.length) throw new Error("no rate files found in the carrier's index");
      const sid = `${src.carrier}:skipped`;
      const data = { carrier: src.carrier, carrierName: src.carrierName, network: "Files not reduced", url: "", status: "skipped", stats: { skipped: d.skipped }, processedAt: new Date() };
      await db.rateFile.upsert({ where: { id: sid }, create: { id: sid, ...data }, update: data });
    } catch (e) {
      failures++;
      await db.rateFile.upsert({
        where: { id: `${src.carrier}:discovery` },
        create: { id: `${src.carrier}:discovery`, carrier: src.carrier, carrierName: src.carrierName, network: "discovery", url: "", status: "failed", error: (e as Error).message.slice(0, 500) },
        update: { status: "failed", error: (e as Error).message.slice(0, 500), processedAt: new Date() },
      });
      continue;
    }
    await db.rateFile.deleteMany({ where: { id: `${src.carrier}:discovery` } });
    for (const f of files) {
      const id = `${src.carrier}:${f.network.replace(/\s*\(.*\)$/, "")}`;
      try {
        const r = await reduceSource(f.url, { tins: tracked });
        r.rows.forEach((x) => tracked.add(x.tin));
        await db.$transaction(async (tx) => {
          await tx.rateFile.upsert({
            where: { id },
            create: { id, carrier: src.carrier, carrierName: src.carrierName, network: f.network, url: f.url, status: "ok", reportingEntity: r.meta.reportingEntity, lastUpdated: r.meta.lastUpdated, stats: r.stats, processedAt: new Date() },
            update: { network: f.network, url: f.url, status: "ok", error: null, reportingEntity: r.meta.reportingEntity, lastUpdated: r.meta.lastUpdated, stats: r.stats, processedAt: new Date() },
          });
          await tx.rateSummary.deleteMany({ where: { fileId: id } });
          await tx.providerRate.deleteMany({ where: { fileId: id } });
          await tx.rateSummary.createMany({ data: r.summary.map((s) => ({ ...s, fileId: id })) });
          for (let i = 0; i < r.rows.length; i += 2000) await tx.providerRate.createMany({ data: r.rows.slice(i, i + 2000).map((x) => ({ ...x, fileId: id })) });
        }, { timeout: 120_000 });
        written += r.rows.length + r.summary.length;
      } catch (e) {
        failures++;
        // Keep last month's data; just record the failure.
        await db.rateFile.upsert({
          where: { id },
          create: { id, carrier: src.carrier, carrierName: src.carrierName, network: f.network, url: f.url, status: "failed", error: (e as Error).message.slice(0, 500), processedAt: new Date() },
          update: { status: "failed", error: (e as Error).message.slice(0, 500), processedAt: new Date() },
        });
      }
    }
  }
  written += await loadSnapshots();
  if (!written && failures) throw new Error(`All ${failures} rate files failed — see Rates page`);
  return written;
}

type Snapshot = { carrier: string; carrierName: string; network: string; url: string; reportingEntity: string | null; lastUpdated: string | null; note?: string; stats: Record<string, number>; rows: RateRow[] };

/**
 * National carriers' files are reduced offline (`npm run mrf:reduce`, needs ~2 GB RAM for a 300 GB file) and shipped as
 * small snapshots in data/rates/, filtered to providers the regional files track. Re-generate when the carrier posts new files.
 */
async function loadSnapshots(): Promise<number> {
  const dir = join(process.cwd(), "data", "rates");
  let names: string[] = [];
  try { names = (await readdir(dir)).filter((n) => n.endsWith(".json")); } catch { return 0; }
  let n = 0;
  for (const name of names) {
    const s = JSON.parse(await readFile(join(dir, name), "utf8")) as Snapshot;
    const id = `${s.carrier}:${s.network.replace(/\s*\(.*\)$/, "")}`;
    await db.$transaction(async (tx) => {
      const data = { carrier: s.carrier, carrierName: s.carrierName, network: s.network, url: s.url, status: "ok", error: s.note ?? null, reportingEntity: s.reportingEntity, lastUpdated: s.lastUpdated, stats: s.stats, processedAt: new Date() };
      await tx.rateFile.upsert({ where: { id }, create: { id, ...data }, update: data });
      await tx.providerRate.deleteMany({ where: { fileId: id } });
      for (let i = 0; i < s.rows.length; i += 2000) await tx.providerRate.createMany({ data: s.rows.slice(i, i + 2000).map((x) => ({ ...x, providerName: x.providerName && !/^unknown$/i.test(x.providerName) ? x.providerName : null, fileId: id })) });
    }, { timeout: 120_000 });
    n += s.rows.length;
  }
  return n;
}
