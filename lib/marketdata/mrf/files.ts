import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { db } from "../../db";
import type { RateRow, RateSummary, ReduceResult } from "./reduce";
import { reduceSources } from "./source";

/**
 * Carriers whose negotiated-rate files are reduced live every month. File names change monthly, so each source
 * discovers its current files from the carrier's own index. Each source is its own import job (dataset "rates",
 * year = position below) so no single job runs long. Files too large or not reachable from a server are reduced
 * offline into data/rates/ snapshots (year 99).
 */
export type Skipped = { reason: string; files: number; example: string };
type Found = { carrier: string; carrierName: string; network: string; urls: string[] };
type Discovered = { files: Found[]; skipped: Array<{ carrier: string; carrierName: string; url: string; reason: string }> };
type RateSource = { id: string; label: string; discover(): Promise<Discovered> };

const UA = { "User-Agent": "Mozilla/5.0 (compatible; PayersightBot; +https://github.com/samuelbhendrix-boop/lookout)" };
async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`);
  return JSON.parse((await res.text()).replace(/^﻿/, "")) as T;
}
type Toc = { reporting_structure?: Array<{ in_network_files?: Array<{ location: string; description?: string }> }> };
const filesOf = (toc: Toc) => (toc.reporting_structure ?? []).flatMap((s) => s.in_network_files ?? []);

const MGB = { carrier: "mgb", carrierName: "Mass General Brigham Health Plan" };
const HP = { carrier: "harvard_pilgrim", carrierName: "Harvard Pilgrim Health Care" };
const TUFTS = { carrier: "tufts", carrierName: "Tufts Health Plan" };
const FALLON = { carrier: "fallon", carrierName: "Fallon Health" };
const NHPRI = { carrier: "nhpri", carrierName: "Neighborhood Health Plan of Rhode Island" };
const CHO = { carrier: "cho", carrierName: "Maine Community Health Options" };
const title = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bHmo\b/, "HMO").replace(/\bPpo\b/, "PPO").replace(/\bAso\b/, "ASO (self-funded)");

export const RATE_SOURCES: RateSource[] = [
  {
    id: "mgb",
    label: MGB.carrierName,
    async discover() {
      const toc = await json<Toc>("https://massgeneralbrighamhealthplan.org/pricetransparency/MRF/Base");
      const files: Found[] = [];
      const skipped: Discovered["skipped"] = [];
      for (const f of new Map(filesOf(toc).map((x) => [x.location, x])).values()) {
        const m = /\/INN\/AWHP\/INN_([A-Z_]+?)_[\d-]+\.json\.gz$/.exec(f.location);
        if (m) files.push({ ...MGB, network: title(m[1]), urls: [f.location] });
        else skipped.push({ ...MGB, url: f.location, reason: /\/CAP\//.test(f.location) ? "Capitation files — per-member payments, no per-service prices to compare"
          : /\/Vendors\//.test(f.location) ? "Behavioral health vendor network (Optum) — the vendor's own contracts, not MGB's"
          : /multiplan/i.test(f.location) ? "Rented MultiPlan PHCS network for out-of-area members — MultiPlan's national contracts, not MGB's"
          : /uhc\.com/.test(f.location) ? "Rented UnitedHealthcare Options PPO for out-of-area members — covered by the UnitedHealthcare snapshot"
          : "Other file — not a medical in-network rate file" });
      }
      return { files, skipped };
    },
  },
  {
    id: "harvard_pilgrim",
    label: HP.carrierName,
    async discover() {
      // The plan list links one index per employer group; together they reference every Harvard Pilgrim network file.
      const html = await (await fetch("https://eusprdtransparencymrfp32.z13.web.core.windows.net/hphc", { headers: UA, signal: AbortSignal.timeout(60_000) })).text();
      const indexes = [...new Set(html.match(/https:\/\/eusprdtransparencymrfp32\.blob\.core\.windows\.net\/hphc\/[^'"\s]+_index\.json/g) ?? [])];
      if (!indexes.length) throw new Error("No index links on the Harvard Pilgrim plan list — page layout may have changed");
      const counts = new Map<string, number>();
      const skipped: Discovered["skipped"] = [];
      for (const u of indexes) {
        try {
          for (const f of filesOf(await json<Toc>(u))) {
            if (/eusprdtransparencymrfp32\.blob\.core\.windows\.net\/hphc\/.*_in-network-rates\.zip$/.test(f.location) && !/Dental/i.test(f.location)) counts.set(f.location, (counts.get(f.location) ?? 0) + 1);
            else if (!counts.has(f.location)) skipped.push({ ...HP, url: f.location, reason: /Dental/i.test(f.location) ? "Dental networks — outside the medical benchmark" : /uhc\.com/.test(f.location) ? "Rented UnitedHealthcare networks for out-of-area members — covered by the UnitedHealthcare snapshot" : "Other file — not a medical in-network rate file" });
          }
        } catch {
          skipped.push({ ...HP, url: u, reason: "Employer index files that failed to download this month (their networks are usually listed in other indexes too)" });
        }
      }
      const dedupSkipped = [...new Map(skipped.map((s) => [s.url, s])).values()];
      const files = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([url, n]) => ({ ...HP, network: `${/_(A\d+-\w+?)_in-network/.exec(url)?.[1] ?? "network"} (${n} group${n === 1 ? "" : "s"})`, urls: [url] }));
      return { files, skipped: dedupSkipped };
    },
  },
  {
    id: "tufts",
    label: TUFTS.carrierName,
    async discover() {
      const html = await (await fetch("https://eusprdtransparencymrfp32.z13.web.core.windows.net/thp", { headers: UA, signal: AbortSignal.timeout(60_000) })).text();
      const indexes = [...new Set(html.match(/https:\/\/eusprdtransparencymrfp32\.blob\.core\.windows\.net\/thp\/[^'"\s]+_index\.json/g) ?? [])];
      if (!indexes.length) throw new Error("No index links on the Tufts plan list — page layout may have changed");
      const files = new Map<string, Found>();
      for (const u of indexes) {
        for (const f of filesOf(await json<Toc>(u))) {
          const name = /_TuftsHealthPublicPlans_(\w+?)_in-network/.exec(f.location)?.[1] ?? f.description ?? "network";
          files.set(f.location, { ...TUFTS, network: `Tufts Health ${name.replace(/([a-z])([A-Z])/g, "$1 $2")}`, urls: [f.location] });
        }
      }
      return { files: [...files.values()], skipped: [] };
    },
  },
  {
    id: "fallon",
    label: FALLON.carrierName,
    async discover() {
      const html = await (await fetch("https://fallon.sapphiremrfhub.com/", { headers: UA, signal: AbortSignal.timeout(60_000) })).text();
      const tocUrl = html.match(/https:\/\/fallon\.sapphiremrfhub\.com\/tocs\/\d+\/[^"'\s]+_index\.json/)?.[0];
      if (!tocUrl) throw new Error("No table-of-contents link on Fallon's Sapphire hub page");
      const files: Found[] = [];
      const skipped: Discovered["skipped"] = [];
      for (const f of new Map(filesOf(await json<Toc>(tocUrl)).map((x) => [x.location, x])).values()) {
        const d = f.description ?? "";
        if (/medical/i.test(d)) files.push({ ...FALLON, network: "Medical network", urls: [f.location] });
        else if (/behavio/i.test(d)) files.push({ ...FALLON, network: "Behavioral health (Beacon)", urls: [f.location] });
        else skipped.push({ ...FALLON, url: f.location, reason: `${d || "Other"} file — outside the medical benchmark (dental, chiropractic, vision)` });
      }
      return { files, skipped };
    },
  },
  {
    id: "nhpri",
    label: NHPRI.carrierName,
    async discover() {
      // Plain IIS directory listing; each month adds a facility file and a medical/professional file — one network, two parts.
      const html = await (await fetch("https://files.nhpri.org/mrf/nhp/InNetwork/", { headers: UA, signal: AbortSignal.timeout(60_000) })).text();
      const links = [...html.matchAll(/HREF="(\/mrf\/nhp\/InNetwork\/(\d{4}-\d{2})-\d{2}_[^"]+)"/g)].map((m) => ({ url: `https://files.nhpri.org${m[1]}`, month: m[2] }));
      const latest = links.map((l) => l.month).sort().at(-1);
      if (!latest) throw new Error("No in-network files in NHPRI's directory listing");
      const cur = links.filter((l) => l.month === latest);
      return {
        files: [{ ...NHPRI, network: "Commercial (Exchange)", urls: cur.map((l) => l.url) }],
        skipped: [
          ...links.filter((l) => l.month !== latest).map((l) => ({ ...NHPRI, url: l.url, reason: "Earlier months' files — superseded by the latest month" })),
          ...cur.filter((l) => /MedicalDental/i.test(l.url)).map((l) => ({ ...NHPRI, url: l.url, reason: "Gap in NHPRI's own publication: its 'MedicalDental' file holds dental codes only, so no professional (physician) rates are published; facility rates come by APC and DRG" })),
        ],
      };
    },
  },
  {
    id: "cho",
    label: CHO.carrierName,
    async discover() {
      // One fixed zip, linked from healthoptions.org; staleness is visible via the file's own last_updated_on.
      const url = "https://www.healthoptions.org/machinereadable/InNetwork.zip";
      const head = await fetch(url, { method: "HEAD", headers: UA, signal: AbortSignal.timeout(60_000) });
      if (!head.ok) throw new Error(`HTTP ${head.status} for ${url}`);
      const modified = head.headers.get("last-modified");
      const ageDays = modified ? (Date.now() - Date.parse(modified)) / 864e5 : 0;
      return {
        files: [{ ...CHO, network: "Individual & small group", urls: [url] }],
        skipped: ageDays > 45 ? [{ ...CHO, url, reason: `Stale at the source: Community Health Options last updated its rate file ${modified} (${Math.round(ageDays)} days ago); federal rules require monthly updates. Rates shown are from that file.` }] : [],
      };
    },
  },
];

/** Thrown when a source stops at its memory budget; the scheduler starts a fresh process that resumes from the cursor. */
export class ResumeLater extends Error {
  constructor(public done: number, public total: number, public rows: number) { super(`processed ${done}/${total} networks; resuming in a fresh process`); }
}
// Native memory (Prisma engine, zlib) grows across many networks in one process; stop below this and resume.
const RSS_BUDGET = (Number(process.env.RATES_RSS_BUDGET_MB) || 330) * 1e6;

export const SNAPSHOT_YEAR = 99;
export const rateSourceForYear = (year: number) => (year === SNAPSHOT_YEAR ? null : RATE_SOURCES[year - 1]);
export const rateDatasetLabel = (year: number) => (year === SNAPSHOT_YEAR ? "Negotiated rates — offline snapshots" : `Negotiated rates — ${RATE_SOURCES[year - 1]?.label ?? `source ${year}`}`);

/** Identical networks (same contracts published under several product names) are stored once. */
function fingerprint(r: Pick<ReduceResult, "rows" | "summary">) {
  const h = createHash("sha1");
  for (const s of [...r.summary].sort((a, b) => `${a.codeType}${a.code}${a.billingClass}${a.negotiatedType}`.localeCompare(`${b.codeType}${b.code}${b.billingClass}${b.negotiatedType}`))) h.update(`${s.codeType}|${s.code}|${s.billingClass}|${s.negotiatedType}|${s.providers}|${s.p25}|${s.p50}|${s.p75}\n`);
  for (const x of [...r.rows].map((x) => `${x.tin}|${x.codeType}|${x.code}|${x.billingClass}|${x.negotiatedType}|${x.median}`).sort()) h.update(x);
  return h.digest("hex");
}

const rowKey = (x: Pick<RateRow, "tin" | "codeType" | "code" | "billingClass" | "negotiatedType">) => `${x.tin}|${x.codeType}|${x.code}|${x.billingClass}|${x.negotiatedType}`;

/**
 * Delta storage: a carrier's first (most-used) network is stored in full; its other networks store only prices that
 * differ, plus tombstones (n = 0) for base prices the network doesn't have. queries.ts rebuilds each network exactly.
 * Harvard Pilgrim's 31 distinct networks differ from the main one in 0–28% of prices, so this stores ~5× fewer rows.
 */
export function deltaRows(rows: RateRow[], base: RateRow[]): RateRow[] {
  const b = new Map(base.map((x) => [rowKey(x), x]));
  const out: RateRow[] = [];
  const seen = new Set<string>();
  for (const x of rows) {
    const k = rowKey(x);
    seen.add(k);
    const y = b.get(k);
    if (!y || Math.abs(y.median - x.median) > 0.005 || y.min !== x.min || y.max !== x.max) out.push(x);
  }
  for (const [k, y] of b) if (!seen.has(k)) out.push({ ...y, n: 0, min: 0, median: 0, max: 0 });
  return out;
}

async function store(id: string, f: Found, r: ReduceResult, sameAs?: string, base?: { id: string; rows: RateRow[] }) {
  const rows = base ? deltaRows(r.rows, base.rows) : r.rows;
  const stats = { ...r.stats, ...(sameAs ? { sameAs } : {}), ...(base ? { baseId: base.id, storedRows: rows.length } : {}) } as object;
  await db.$transaction(async (tx) => {
    const data = { carrier: f.carrier, carrierName: f.carrierName, network: f.network, url: f.urls[0], status: sameAs ? "duplicate" : "ok", error: sameAs ? `Same rates as ${sameAs.split(":").slice(1).join(":")}` : null, reportingEntity: r.meta.reportingEntity, lastUpdated: r.meta.lastUpdated, stats, processedAt: new Date() };
    await tx.rateFile.upsert({ where: { id }, create: { id, ...data }, update: data });
    await tx.rateSummary.deleteMany({ where: { fileId: id } });
    await tx.providerRate.deleteMany({ where: { fileId: id } });
    if (sameAs) return;
    await tx.rateSummary.createMany({ data: r.summary.map((s) => ({ ...s, fileId: id })) });
    for (let i = 0; i < rows.length; i += 2000) await tx.providerRate.createMany({ data: rows.slice(i, i + 2000).map((x) => ({ ...x, fileId: id })) });
  }, { timeout: 300_000 });
}

/** Import one rate source (year = 1-based index into RATE_SOURCES) or the offline snapshots (year 99). Returns rows written. */
export async function importRates(year = 1): Promise<number> {
  const n = await importRatesInner(year);
  // Recompute the stored carrier index here, in the import process, never in the web process.
  const { refreshCarrierIndex } = await import("./queries");
  await refreshCarrierIndex();
  const { loadHistorySeeds } = await import("../history");
  await loadHistorySeeds();
  const { detectAll } = await import("../events");
  await detectAll(["rates"]);
  return n;
}

async function importRatesInner(year: number): Promise<number> {
  if (year === SNAPSHOT_YEAR) return loadSnapshots();
  const src = rateSourceForYear(year);
  if (!src) throw new Error(`No rate source #${year}`);
  // Keep detail for providers already tracked anywhere, so every carrier reports the same hospitals.
  // SELECT DISTINCT in SQL: Prisma's `distinct` dedupes in memory after loading every row.
  const tracked = new Set((await db.$queryRaw<Array<{ tin: string }>>`SELECT DISTINCT tin FROM "ProviderRate" WHERE n > 0`).map((r) => r.tin));
  const discoveryId = `${src.id}:discovery`;
  let d: Discovered;
  try {
    d = await src.discover();
    if (!d.files.length) throw new Error("no rate files found in the carrier's index");
  } catch (e) {
    const data = { carrier: src.id, carrierName: src.label, network: "discovery", url: "", status: "failed", error: (e as Error).message.slice(0, 500), processedAt: new Date() };
    await db.rateFile.upsert({ where: { id: discoveryId }, create: { id: discoveryId, ...data }, update: data });
    throw e;
  }
  await db.rateFile.deleteMany({ where: { id: discoveryId } });
  const sid = `${src.id}:skipped`;
  const grouped = new Map<string, Skipped & { carrierName: string }>();
  for (const s of d.skipped) {
    const k = `${s.carrierName}\t${s.reason}`;
    const x = grouped.get(k) ?? { carrierName: s.carrierName, reason: s.reason, files: 0, example: s.url };
    x.files++;
    grouped.set(k, x);
  }
  const skipData = { carrier: src.id, carrierName: src.label, network: "Files not reduced", url: "", status: "skipped", stats: { skipped: [...grouped.values()] }, processedAt: new Date() };
  await db.rateFile.upsert({ where: { id: sid }, create: { id: sid, ...skipData }, update: skipData });

  const seen = new Set<string>([sid]);
  const prints = new Map<string, string>();
  const bases = new Map<string, { id: string; rows: RateRow[] }>(); // carrier → its first stored network
  // Resume support: same discovered file list (signature) → skip networks already done, reload delta bases from the DB.
  const cursorId = `${src.id}:cursor`;
  const sig = createHash("sha1").update(d.files.map((f) => f.urls.join(",")).join("\n")).digest("hex");
  const cursor = await db.rateFile.findUnique({ where: { id: cursorId } });
  const cs = (cursor?.stats ?? {}) as { sig?: string; next?: number; bases?: Record<string, string> };
  const start = cs.sig === sig ? cs.next ?? 0 : 0;
  if (start) {
    for (const [carrier, id] of Object.entries(cs.bases ?? {})) {
      const rows = await db.providerRate.findMany({ where: { fileId: id } });
      bases.set(carrier, { id, rows: rows.map(({ id: _i, fileId: _f, ...x }) => x) });
    }
  }
  let written = 0, failures = 0;
  for (const [i, f] of d.files.entries()) {
    const id = `${f.carrier}:${f.network.replace(/\s*\(.*\)$/, "")}`;
    seen.add(id);
    if (i < start) continue;
    try {
      const r = await reduceSources(f.urls, { tins: tracked });
      r.rows.forEach((x) => tracked.add(x.tin));
      const fp = fingerprint(r);
      const dup = prints.get(fp);
      if (!dup) prints.set(fp, id);
      const base = dup ? undefined : bases.get(f.carrier);
      await store(id, f, r, dup, base);
      if (!dup && !base) bases.set(f.carrier, { id, rows: r.rows });
      written += dup ? 0 : r.rows.length + r.summary.length;
      if (process.env.RATES_DEBUG_MEM) { const m = process.memoryUsage(); console.log(`${id} rss ${Math.round(m.rss / 1e6)} heap ${Math.round(m.heapUsed / 1e6)} ext ${Math.round(m.external / 1e6)}`); }
      if (process.memoryUsage().rss > RSS_BUDGET && i < d.files.length - 1) {
        const data = { carrier: src.id, carrierName: src.label, network: "resume cursor", url: "", status: "cursor", stats: { sig, next: i + 1, bases: Object.fromEntries([...bases].map(([c, b]) => [c, b.id])) }, processedAt: new Date() };
        await db.rateFile.upsert({ where: { id: cursorId }, create: { id: cursorId, ...data }, update: data });
        throw new ResumeLater(i + 1, d.files.length, written);
      }
    } catch (e) {
      if (e instanceof ResumeLater) throw e;
      failures++;
      // Keep last month's data for this network; just record the failure.
      const data = { carrier: f.carrier, carrierName: f.carrierName, network: f.network, url: f.urls[0], status: "failed", error: (e as Error).message.slice(0, 500), processedAt: new Date() };
      await db.rateFile.upsert({ where: { id }, create: { id, ...data }, update: { status: "failed", error: data.error, processedAt: data.processedAt } });
    }
  }
  await db.rateFile.deleteMany({ where: { id: cursorId } });
  // Networks the carrier no longer publishes.
  const carriers = [...new Set([src.id, ...d.files.map((f) => f.carrier)])];
  await db.rateFile.deleteMany({ where: { carrier: { in: carriers }, id: { notIn: [...seen, cursorId] }, NOT: { id: { startsWith: "snap:" } } } });
  if (!written && failures) throw new Error(`All ${failures} ${src.label} rate files failed — see Rates page`);
  return written || 1;
}

export type Snapshot = {
  carrier: string; carrierName: string; network: string; url: string; reportingEntity: string | null; lastUpdated: string | null;
  note?: string; stats: Record<string, number>; rows: RateRow[]; summary?: RateSummary[];
  skipped?: Array<{ reason: string; files: number; example: string }>;
};

/**
 * Files reduced offline (`npm run mrf:snapshot`) and shipped in data/rates/: national files too big for the server, and
 * files whose host only serves browsers. Each carries its own provenance note.
 */
async function loadSnapshots(): Promise<number> {
  const dir = join(process.cwd(), "data", "rates");
  let names: string[] = [];
  try { names = (await readdir(dir)).filter((n) => /\.json(\.gz)?$/.test(n)).sort(); } catch { return 0; }
  let n = 0;
  const ids: string[] = [];
  const prints = new Map<string, string>();
  const bases = new Map<string, { id: string; rows: RateRow[] }>();
  for (const name of names) {
    const raw = await readFile(join(dir, name));
    const s = JSON.parse((name.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8")) as Snapshot;
    const id = `snap:${name.replace(/\.json(\.gz)?$/, "")}`;
    ids.push(id);
    const fp = s.rows.length ? `${s.carrier}:${fingerprint({ rows: s.rows, summary: s.summary ?? [] })}` : null;
    const dup = fp ? prints.get(fp) : undefined;
    if (fp && !dup) prints.set(fp, `${s.carrier}:${s.network}`);
    const base = dup || !s.rows.length ? undefined : bases.get(s.carrier);
    if (!dup && !base && s.rows.length) bases.set(s.carrier, { id, rows: s.rows });
    const rows = base ? deltaRows(s.rows, base.rows) : s.rows;
    await db.$transaction(async (tx) => {
      const status = s.network === "Files not reduced" ? "skipped" : dup ? "duplicate" : "ok";
      const data = { carrier: s.carrier, carrierName: s.carrierName, network: s.network, url: s.url, status, error: dup ? `Same rates as ${dup.split(":").slice(1).join(":")}` : s.note ?? null, reportingEntity: s.reportingEntity, lastUpdated: s.lastUpdated, stats: { ...s.stats, snapshot: 1, ...(s.skipped ? { skipped: s.skipped } : {}), ...(base ? { baseId: base.id, storedRows: rows.length } : {}) }, processedAt: new Date() };
      await tx.rateFile.upsert({ where: { id }, create: { id, ...data }, update: data });
      await tx.rateSummary.deleteMany({ where: { fileId: id } });
      await tx.providerRate.deleteMany({ where: { fileId: id } });
      if (dup) return;
      if (s.summary?.length) await tx.rateSummary.createMany({ data: s.summary.map((x) => ({ ...x, fileId: id })) });
      for (let i = 0; i < rows.length; i += 2000) await tx.providerRate.createMany({ data: rows.slice(i, i + 2000).map((x) => ({ ...x, providerName: x.providerName && !/^unknown$/i.test(x.providerName) ? x.providerName : null, fileId: id })) });
    }, { timeout: 300_000 });
    n += s.rows.length;
  }
  // Snapshots removed from the repo, and the pre-0.9 UHC id.
  await db.rateFile.deleteMany({ where: { OR: [{ id: { startsWith: "snap:" }, NOT: { id: { in: ids } } }, { id: "uhc:Options PPO" }] } });
  return n;
}
