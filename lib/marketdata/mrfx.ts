import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { findRelease, type Release } from "./ghrelease";

/**
 * Loads the monthly MRF extract's market summary (built for free in GitHub Actions by .github/workflows/mrf-extract.yml)
 * from the newest "mrf-YYYY-MM" release: what every carrier pays New England providers for each of ~2,500 services.
 */
const UA = { "User-Agent": "Mozilla/5.0 (compatible; PayersightBot; +https://github.com/samuelbhendrix-boop/lookout)" };
export const MRF_REPO = "samuelbhendrix-boop/lookout";

export async function latestExtract(): Promise<Release | null> {
  return findRelease("mrf", "summary-code-rates.csv.gz", ["manifest.json"]);
}

export async function importMrfExtract(): Promise<number> {
  const rel = await latestExtract();
  if (!rel) throw new Error("No monthly MRF extract published yet (GitHub release mrf-YYYY-MM). It runs on the 4th of each month, or start it from the repo's Actions tab.");
  const month = rel.tag_name.slice(4);
  // Same release as last time (and not republished since): nothing to reload.
  const prev = await extractInfo();
  if (prev?.version === rel.version) { const n = await db.marketCodeRate.count({ where: { month } }); if (n) return n; }
  const asset = (n: string) => rel.assets.find((a) => a.name === n)!.browser_download_url;
  const manifest = (await (await fetch(asset("manifest.json"), { headers: UA })).json()) as { sources: Array<{ carrier: string; carrierName: string }>; failed: Array<{ carrierName?: string; network?: string; error?: string }> };
  const names = new Map(manifest.sources.map((s) => [s.carrier, s.carrierName]));
  const res = await fetch(asset("summary-code-rates.csv.gz"), { headers: UA, signal: AbortSignal.timeout(20 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`summary download: HTTP ${res.status}`);
  // The summary is small (a few MB): read it whole and gunzip as many times as it is gzipped. Some downloads arrive
  // already decompressed (the CDN can apply Content-Encoding), some gzipped once; checking the magic bytes handles both.
  let buf: Buffer = Buffer.from(await res.arrayBuffer());
  while (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  // Split in memory (a readline over an already-finished stream can miss its end and stall the process).
  const lines = buf.toString("utf8").split(/\r?\n/).filter((l) => l.length);
  let header: string[] | null = null;
  let batch: Prisma.MarketCodeRateCreateManyInput[] = [];
  let n = 0;
  await db.marketCodeRate.deleteMany({ where: { month } });
  for (const line of lines) {
    const v = line.split(",");
    if (!header) {
      header = v.map((h) => h.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").trim());
      if (!["carrier", "code", "median"].every((k) => header!.includes(k))) throw new Error(`summary has unexpected columns: ${line.slice(0, 200)}`);
      continue;
    }
    const r = Object.fromEntries(header.map((h, i) => [h, v[i]]));
    if (!r.carrier || !r.code || !Number.isFinite(Number(r.median))) continue;
    batch.push({ month, carrier: r.carrier, carrierName: names.get(r.carrier) ?? r.carrier, state: r.state, codeType: r.code_type, code: r.code, billingClass: r.billing_class, providers: Number(r.providers), p25: Number(r.p25), median: Number(r.median), p75: Number(r.p75) });
    if (batch.length === 5000) { await db.marketCodeRate.createMany({ data: batch }); n += batch.length; batch = []; }
  }
  if (batch.length) { await db.marketCodeRate.createMany({ data: batch }); n += batch.length; }
  await db.marketCodeRate.deleteMany({ where: { month: { not: month } } });
  const data = { carrier: "_cache", carrierName: "_cache", network: "mrfx", url: rel.html_url, status: "cache", stats: JSON.parse(JSON.stringify({ month, release: rel.tag_name, version: rel.version, url: rel.html_url, failed: manifest.failed.slice(0, 50), files: manifest.sources.length })), processedAt: new Date() };
  await db.rateFile.upsert({ where: { id: "cache:mrfx" }, create: { id: "cache:mrfx", ...data }, update: data });
  return n;
}

export async function extractInfo() {
  const row = await db.rateFile.findUnique({ where: { id: "cache:mrfx" } });
  return (row?.stats as { month: string; release: string; version?: string; url: string; failed: Array<{ carrierName?: string; network?: string; error?: string }>; files: number } | null) ?? null;
}

// ── Service catalog (data/mrf/codes.csv, built by scripts/build-mrf-codes.py) ──────────────────────────────────────
export type Service = { type: string; code: string; rank: number; spend: number; description: string };
let catalog: Service[] | null = null;
export function services(): Service[] {
  if (catalog) return catalog;
  const text = readFileSync(join(process.cwd(), "data", "mrf", "codes.csv"), "utf8");
  const out: Service[] = [];
  for (const line of text.split("\n").slice(1)) {
    const m = /^([^,]+),([^,]+),(\d+),(\d+),(.*)$/.exec(line.trim());
    if (m) out.push({ type: m[1], code: m[2], rank: Number(m[3]), spend: Number(m[4]), description: m[5].replace(/^"|"$/g, "").replace(/""/g, '"') });
  }
  return (catalog = out);
}
