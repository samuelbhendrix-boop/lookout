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
type RateSource = { carrier: string; carrierName: string; discover(): Promise<Array<{ network: string; url: string }>> };

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
      for (const f of filesOf(toc)) {
        const m = /\/INN\/AWHP\/INN_(COMMERCIAL_HMO|COMMERCIAL_PPO)_[\d-]+\.json\.gz$/.exec(f.location);
        if (m) pick.set(m[1] === "COMMERCIAL_HMO" ? "Commercial HMO" : "Commercial PPO", f.location);
      }
      return [...pick].map(([network, url]) => ({ network, url }));
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
      for (const u of indexes) {
        try {
          for (const f of filesOf(await json<Toc>(u))) {
            if (/eusprdtransparencymrfp32\.blob\.core\.windows\.net\/hphc\/.*_A\d+-FS_in-network-rates\.zip$/.test(f.location)) counts.set(f.location, (counts.get(f.location) ?? 0) + 1);
          }
        } catch { /* one bad index shouldn't sink discovery */ }
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([url, n]) => ({ network: `Network ${/_(A\d+)-FS_/.exec(url)![1]} (${n} groups)`, url }));
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
      files = await src.discover();
      if (!files.length) throw new Error("no rate files found in the carrier's index");
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
      for (let i = 0; i < s.rows.length; i += 2000) await tx.providerRate.createMany({ data: s.rows.slice(i, i + 2000).map((x) => ({ ...x, fileId: id })) });
    }, { timeout: 120_000 });
    n += s.rows.length;
  }
  return n;
}
