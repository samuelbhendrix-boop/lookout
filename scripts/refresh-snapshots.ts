/**
 * Monthly refresh of the offline rate snapshots in data/rates/ (the files too big, or too awkwardly hosted, for the
 * server's own monthly import). For each snapshot it finds the current month's file from the carrier's public index,
 * re-reduces it, and rewrites the snapshot. Anything it can't refresh keeps last month's snapshot and is reported stale.
 *
 *   npx tsx scripts/refresh-snapshots.ts [--only cigna,aetna,uhc,blue] [--blue-toc <path or URL>] [--dry-run]
 *
 * Discovery, per carrier (all fetched with the honest PayersightBot user agent):
 *   Cigna  www.cigna.com/static/mrf/latest.json → TOC zip → the Cigna Health & Life index → network file by slug
 *   Aetna  HealthSparq latest_metadata.json for the same entity folder → file by network code (pl-sk, pl-wg, …)
 *   UHC    transparency-in-coverage.uhc.com blob listing → newest file with the same name after the date
 *   Blues  Anthem's monthly index (public, ~2 GB, streamed): Anthem CT/ME/NH networks and the BCBSRI and BCBSVT host
 *          files. BCBSMA HMO Blue and Anthem NH's HMO Blue New England Choice are listed only in BCBSMA's index, which
 *          only serves browsers: save it as data/blue-toc.json to refresh those two; otherwise they're kept and flagged.
 * Provider detail is kept for TINs in any snapshot plus every mapped hospital (plus the database's tracked TINs when
 * DATABASE_URL is reachable — optional).
 * Exit code 0 even when some files fail; the summary at the end (and refresh-report.json) says what happened.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import yauzl from "yauzl";
import { reduceSources } from "../lib/marketdata/mrf/source";
import type { Snapshot } from "../lib/marketdata/mrf/files";
import tinMap from "../data/medicare/hospital-tins.json";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; PayersightBot; +https://github.com/samuelbhendrix-boop/lookout)" };
const DIR = "data/rates";
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const ONLY = arg("--only")?.split(",");
const DRY = process.argv.includes("--dry-run");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Kind = "cigna" | "aetna" | "uhc" | "blue";
type Entry = { file: string; snap: Snapshot; kind: Kind };
type Result = { file: string; status: "refreshed" | "current" | "stale" | "failed"; detail: string };

export function kindOf(url: string): Kind | null {
  if (url.includes("cloudfront.net/cost_transparency")) return "cigna";
  if (url.includes("healthsparq.com")) return "aetna";
  if (url.includes("transparency-in-coverage.uhc.com")) return "uhc";
  if (url.includes("mrf.bcbs.com")) return "blue";
  return null;
}

async function getJson<T>(url: string, timeoutMin = 5): Promise<T> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMin * 60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split("?")[0]}`);
  return (await res.json()) as T;
}
async function getBuffer(url: string) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split("?")[0]}`);
  return Buffer.from(await res.arrayBuffer());
}
function zipEntry(buf: Buffer, match: (name: string) => boolean): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      zip.on("entry", (e: yauzl.Entry) => {
        if (!match(e.fileName)) return zip.readEntry();
        zip.openReadStream(e, (err2, s) => {
          if (err2 || !s) return reject(err2);
          const parts: Buffer[] = [];
          s.on("data", (c: Buffer) => parts.push(c)).on("end", () => { zip.close(); resolve(Buffer.concat(parts)); }).on("error", reject);
        });
      });
      zip.on("end", () => reject(new Error("entry not found in zip")));
      zip.readEntry();
    });
  });
}

type InNetworkFile = { description?: string; location: string };
type Toc = { reporting_structure: Array<{ in_network_files?: InNetworkFile[] }> };
const tocFiles = (toc: Toc) => {
  const m = new Map<string, string>();
  for (const s of toc.reporting_structure) for (const f of s.in_network_files ?? []) m.set(f.location.split("?")[0].split("/").pop()!, f.location);
  return m;
};

/** Current-month URL(s) for a snapshot, or null if its carrier's index doesn't list it. */
const resolvers: Record<Kind, (e: Entry[]) => Promise<Map<string, string[]>>> = {
  async cigna(entries) {
    const latest = await getJson<{ mrfs: Array<{ kind: string; files: Array<{ file_name: string; url: string }> }> }>("https://www.cigna.com/static/mrf/latest.json");
    const toc = latest.mrfs.find((m) => m.kind === "TOC")?.files[0];
    if (!toc) throw new Error("Cigna latest.json lists no table of contents");
    const zip = await getBuffer(toc.url);
    const index = JSON.parse((await zipEntry(zip, (n) => /cigna-health-life-insurance-company_index\.json$/.test(n))).toString("utf8")) as Toc;
    const files = [...tocFiles(index).entries()];
    const out = new Map<string, string[]>();
    for (const e of entries) {
      const slug = /_cigna-health-life-insurance-company_(.+)_in-network-rates/.exec(e.snap.url)?.[1];
      const hit = slug && files.find(([name]) => name.endsWith(`_cigna-health-life-insurance-company_${slug}_in-network-rates.json.gz`));
      if (hit) out.set(e.file, [hit[1]]);
    }
    return out;
  },
  async aetna(entries) {
    const out = new Map<string, string[]>();
    const byBase = new Map<string, Entry[]>();
    for (const e of entries) {
      const base = /^(.*\/prd\/mrf\/[^/]+\/[^/]+\/)/.exec(e.snap.url)?.[1];
      if (base) byBase.set(base, [...(byBase.get(base) ?? []), e]);
    }
    for (const [base, list] of byBase) {
      const meta = await getJson<{ files: Array<{ fileName: string; filePath: string; fileSchema: string }> }>(`${base}latest_metadata.json`, 10);
      for (const e of list) {
        const code = /_(pl-[a-z0-9]+)-tr\d+[_-]/.exec(e.snap.url)?.[1];
        const hit = code && meta.files.find((f) => f.fileSchema === "IN_NETWORK_RATES" && new RegExp(`_${code}-tr\\d+_[A-Za-z-]+\\.json\\.gz$`).test(f.fileName));
        if (hit) out.set(e.file, [base + hit.filePath]);
      }
    }
    return out;
  },
  async uhc(entries) {
    const { blobs } = await getJson<{ blobs: Array<{ name: string; downloadUrl: string }> }>("https://transparency-in-coverage.uhc.com/api/v1/uhc/blobs/", 10);
    const out = new Map<string, string[]>();
    for (const e of entries) {
      const tail = e.snap.url.split("/").pop()!.replace(/^\d{4}-\d{2}-\d{2}_/, "");
      const hits = blobs.filter((b) => b.name.replace(/^\d{4}-\d{2}-\d{2}_/, "") === tail).sort((a, b) => b.name.localeCompare(a.name));
      if (hits[0]) out.set(e.file, [hits[0].downloadUrl]);
    }
    return out;
  },
  /**
   * The Blues' files live on the BCBS national host with signed links. Two indexes list them: BCBSMA's (browser-only, so
   * used only when a saved copy is supplied) and Anthem's own monthly index, which any client can fetch and which
   * carries Anthem CT/ME/NH's networks plus the BCBSRI and BCBSVT host files. Anthem's is ~2 GB compressed, so it is
   * streamed and only the wanted links are kept.
   */
  async blue(entries) {
    const wanted = new Map<string, Entry[]>(); // "271_35A0" → snapshots
    for (const e of entries) { const m = /\d{4}-\d{2}_(\d+_[0-9A-Z]+)_in-network-rates/.exec(e.snap.url); if (m) wanted.set(m[1], [...(wanted.get(m[1]) ?? []), e]); }
    const found = new Map<string, Map<string, string>>(); // key → file name → signed url
    const add = (name: string, url: string) => { const m = /^\d{4}-\d{2}_(\d+_[0-9A-Z]+)_in-network-rates/.exec(name); if (m && wanted.has(m[1])) { const x = found.get(m[1]) ?? found.set(m[1], new Map()).get(m[1])!; if (!x.has(name)) x.set(name, url); } };
    const src = arg("--blue-toc") ?? ["data/blue-toc.json.gz", "data/blue-toc.json"].find((p) => existsSync(p));
    if (src) {
      const raw = /^https?:/.test(src) ? await getBuffer(src) : readFileSync(src);
      for (const [name, url] of tocFiles(JSON.parse((src.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8")) as Toc)) add(name, url);
    }
    if ([...wanted.keys()].some((k) => !found.has(k))) await scanAnthemIndex(add);
    const out = new Map<string, string[]>();
    for (const [k, es] of wanted) {
      const files = [...(found.get(k) ?? new Map()).entries()];
      const months = [...new Set(files.map(([n]) => n.slice(0, 7)))].sort();
      const newest = files.filter(([n]) => n.startsWith(months.at(-1) ?? "_")).sort(([x], [y]) => x.localeCompare(y, "en", { numeric: true }));
      if (newest.length) for (const e of es) out.set(e.file, newest.map(([, u]) => u));
    }
    return out;
  },
};

/** Stream Anthem's monthly index (this month's, else last month's) and hand every BCBS-host in-network link to `add`. */
async function scanAnthemIndex(add: (name: string, url: string) => void) {
  const { createGunzip } = await import("node:zlib");
  const { Readable } = await import("node:stream");
  const now = new Date();
  for (const back of [0, 1]) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7);
    const url = `https://antm-pt-prod-dataz-nogbd-nophi-us-east1.s3.amazonaws.com/anthem/${d}-01_anthem_index.json.gz`;
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60 * 60_000) });
    if (!res.ok || !res.body) continue;
    const re = /https:\/\/[a-z0-9.-]+\.mrf\.bcbs\.com\/(\d{4}-\d{2}_\d+_[0-9A-Z]+_in-network-rates(?:_\d+_of_\d+)?\.json\.gz)\?[^"\s]*/g;
    let tail = "";
    for await (const chunk of Readable.fromWeb(res.body as never).pipe(createGunzip())) {
      const text = tail + (chunk as Buffer).toString("latin1");
      for (const m of text.matchAll(re)) add(m[1], m[0].replace(/\\u0026/g, "&"));
      tail = text.slice(-2048);
    }
    return;
  }
  throw new Error("Anthem's index for this or last month isn't available");
}

const monthOf = (url: string) => /(\d{4}-\d{2})(-\d{2})?_/.exec(url.split("/").pop() ?? "")?.[1] ?? null;
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

async function main() {
  const entries: Entry[] = [];
  const all: Snapshot[] = [];
  for (const file of readdirSync(DIR).filter((n) => n.endsWith(".json.gz")).sort()) {
    const snap = JSON.parse(gunzipSync(readFileSync(`${DIR}/${file}`)).toString("utf8")) as Snapshot;
    all.push(snap);
    const kind = kindOf(snap.url);
    if (snap.rows.length && kind && (!ONLY || ONLY.includes(kind))) entries.push({ file, snap, kind });
  }
  // Providers to keep detail for: every TIN in any snapshot, every mapped hospital, and (when a database is reachable)
  // every TIN the live monthly import tracks.
  const T = tinMap as { map: Record<string, string>; auto?: Record<string, string>; nonIpps?: Record<string, string> };
  const tracked = new Set<string>([...Object.keys(T.map), ...Object.keys(T.auto ?? {}), ...Object.keys(T.nonIpps ?? {})].filter((t) => /^\d{9}$/.test(t)));
  for (const s of all) for (const r of s.rows) tracked.add(r.tin);
  if (process.env.DATABASE_URL) {
    try {
      const { db } = await import("../lib/db");
      for (const r of await db.$queryRaw<Array<{ tin: string }>>`SELECT DISTINCT tin FROM "ProviderRate" WHERE n > 0`) tracked.add(r.tin);
      await db.$disconnect();
    } catch (e) {
      console.warn("database not reachable; using snapshot TINs only:", (e as Error).message.split("\n")[0]);
    }
  }
  console.log(`${entries.length} snapshots, ${tracked.size} tracked TINs`);

  const results: Result[] = [];
  for (const kind of ["cigna", "aetna", "uhc", "blue"] as Kind[]) {
    const list = entries.filter((e) => e.kind === kind);
    if (!list.length) continue;
    let urls: Map<string, string[]>;
    try {
      urls = await resolvers[kind](list);
    } catch (err) {
      for (const e of list) results.push({ file: e.file, status: "stale", detail: `${(err as Error).message}; kept ${e.snap.lastUpdated ?? "previous"} snapshot` });
      continue;
    }
    for (const e of list) {
      const parts = urls.get(e.file);
      if (!parts?.length) { results.push({ file: e.file, status: "stale", detail: "not listed in the carrier's current index; kept previous snapshot" }); continue; }
      const oldMonth = monthOf(e.snap.url), newMonth = monthOf(parts[0].split("?")[0]);
      if (parts[0].split("?")[0] === e.snap.url || (oldMonth && newMonth && newMonth <= oldMonth)) { results.push({ file: e.file, status: "current", detail: `already ${oldMonth}` }); continue; }
      if (DRY) { results.push({ file: e.file, status: "refreshed", detail: `would reduce ${parts.length} part(s) for ${newMonth} (dry run)` }); continue; }
      const t = Date.now();
      try {
        // National files (no network summary in the old snapshot) stay filtered to tracked providers.
        const national = !e.snap.summary?.length;
        const r = await reduceSources(parts, { tins: tracked });
        const rows = national ? r.rows.filter((x) => tracked.has(x.tin)) : r.rows;
        if (!rows.length) throw new Error("reduced to zero rows — keeping the previous snapshot");
        const note = (e.snap.note ?? "").replace(new RegExp(`${MONTHS.join("|")} \\d{4}`, "g"), newMonth ? monthName(newMonth) : "$&");
        const snap: Snapshot = {
          ...e.snap, url: parts[0].split("?")[0], reportingEntity: r.meta.reportingEntity ?? e.snap.reportingEntity, lastUpdated: r.meta.lastUpdated ?? e.snap.lastUpdated, note,
          stats: { ...r.stats, rows: rows.length, parts: parts.length }, rows, summary: national ? undefined : r.summary,
        };
        writeFileSync(`${DIR}/${e.file}`, gzipSync(JSON.stringify(snap)));
        results.push({ file: e.file, status: "refreshed", detail: `${oldMonth} → ${newMonth}: ${(r.stats.compressedBytes / 1e9).toFixed(2)} GB → ${rows.length} rows in ${Math.round((Date.now() - t) / 60_000)} min` });
      } catch (err) {
        results.push({ file: e.file, status: "failed", detail: `${(err as Error).message}; kept previous snapshot` });
      }
      console.log(results.at(-1));
    }
  }
  const counts = Object.fromEntries((["refreshed", "current", "stale", "failed"] as const).map((s) => [s, results.filter((r) => r.status === s).length]));
  console.log("\nSummary:", JSON.stringify(counts));
  for (const r of results.filter((x) => x.status !== "current")) console.log(`  ${r.status.padEnd(9)} ${r.file}  ${r.detail}`);
  if (!DRY) writeFileSync(`${DIR}/../rates-refresh-report.json`, JSON.stringify({ ranAt: new Date().toISOString(), counts, results }, null, 2) + "\n");
}

if (process.argv[1]?.endsWith("refresh-snapshots.ts")) main().catch((e) => { console.error(e); process.exit(1); });
