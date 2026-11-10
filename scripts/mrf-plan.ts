/**
 * Lists every in-network rate file the monthly MRF extract should read, and splits them into shards for parallel
 * GitHub Actions jobs. Sources:
 *  - the live carriers' own indexes (lib/marketdata/mrf/files.ts RATE_SOURCES: MGB, Harvard Pilgrim, Tufts, Fallon, NHPRI, CHO)
 *  - the snapshot carriers' indexes (scripts/refresh-snapshots.ts: Cigna, Aetna, UHC, Anthem/BCBSRI/BCBSVT, BCBSMA when its index is supplied)
 *  - manual files: assets on the repo's "manual-mrf" GitHub release (see docs/MANUAL-MRF.md)
 *
 *   npx tsx scripts/mrf-plan.ts [shards=24] > plan.json
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { RATE_SOURCES } from "../lib/marketdata/mrf/files";
import type { Snapshot } from "../lib/marketdata/mrf/files";
import { kindOf, resolvers, type Entry, type Kind } from "./refresh-snapshots";
import { manualFiles } from "../lib/marketdata/manual";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; PayersightBot; +https://github.com/samuelbhendrix-boop/lookout)" };
const REPO = process.env.GITHUB_REPOSITORY ?? "samuelbhendrix-boop/lookout";
export type PlanFile = { id: string; carrier: string; carrierName: string; network: string; url: string; source: "live" | "snapshot" | "manual"; bytes: number | null };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

async function size(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD", headers: UA, redirect: "follow", signal: AbortSignal.timeout(30_000) });
    const n = Number(res.headers.get("content-length"));
    return res.ok && n > 0 ? n : null;
  } catch { return null; }
}

async function main() {
  const shards = Number(process.argv[2] ?? 24);
  const files: Array<Omit<PlanFile, "id" | "bytes">> = [];
  const problems: string[] = [];

  for (const src of RATE_SOURCES) {
    try {
      const d = await src.discover();
      for (const f of d.files) for (const url of f.urls) files.push({ carrier: f.carrier, carrierName: f.carrierName, network: f.network, url, source: "live" });
    } catch (e) { problems.push(`${src.label}: ${(e as Error).message}`); }
  }

  // Manual uploads first: a saved BCBSMA index (toc__bcbsma) unlocks the two Blue networks only its index lists.
  let manual: Awaited<ReturnType<typeof manualFiles>> = { hpt: [], tic: [], toc: [] };
  try { manual = await manualFiles(); } catch (e) { problems.push(`manual uploads: ${(e as Error).message}`); }
  const blueToc = manual.toc.find((t) => /bcbsma|blue/.test(t.carrier));
  if (blueToc) process.argv.push("--blue-toc", blueToc.url);
  for (const t of manual.tic) files.push({ carrier: t.carrier, carrierName: t.carrier, network: t.network, url: t.url, source: "manual" });

  const entries: Entry[] = [];
  for (const file of readdirSync("data/rates").filter((n) => n.endsWith(".json.gz"))) {
    const snap = JSON.parse(gunzipSync(readFileSync(`data/rates/${file}`)).toString("utf8")) as Snapshot;
    const kind = kindOf(snap.url);
    if (kind) entries.push({ file, snap, kind });
  }
  for (const kind of ["cigna", "aetna", "uhc", "blue", "bcbsma"] as Kind[]) {
    const list = entries.filter((e) => e.kind === kind);
    try {
      const urls = await resolvers[kind](list);
      for (const e of list) {
        const parts = urls.get(e.file);
        if (!parts?.length) { problems.push(`${e.snap.carrierName} ${e.snap.network}: not in the carrier's current index`); continue; }
        for (const url of parts) files.push({ carrier: e.snap.carrier, carrierName: e.snap.carrierName, network: e.snap.network, url, source: "snapshot" });
      }
    } catch (e) { problems.push(`${kind}: ${(e as Error).message}`); }
  }


  // De-duplicate (rented networks appear under several carriers) and size each file for balancing.
  const uniq = [...new Map(files.map((f) => [f.url.split("?")[0], f])).values()];
  const sized: PlanFile[] = [];
  for (let i = 0; i < uniq.length; i += 16) {
    const batch = uniq.slice(i, i + 16);
    const sizes = await Promise.all(batch.map((f) => size(f.url)));
    batch.forEach((f, j) => sized.push({ ...f, id: `${slug(f.carrier)}-${slug(f.network)}-${(i + j).toString(36)}`, bytes: sizes[j] }));
  }
  // Greedy: biggest file to the lightest shard. Unknown sizes count as 1 GB.
  const bins = Array.from({ length: Math.max(1, Math.min(shards, sized.length)) }, () => ({ bytes: 0, files: [] as PlanFile[] }));
  for (const f of [...sized].sort((a, b) => (b.bytes ?? 1e9) - (a.bytes ?? 1e9))) {
    const bin = bins.reduce((x, y) => (y.bytes < x.bytes ? y : x));
    bin.files.push(f);
    bin.bytes += f.bytes ?? 1e9;
  }
  const plan = { month: new Date().toISOString().slice(0, 7), files: sized.length, totalBytes: sized.reduce((s, f) => s + (f.bytes ?? 0), 0), problems, shards: bins.map((b, i) => ({ shard: i, bytes: b.bytes, files: b.files })) };
  writeFileSync("plan.json", JSON.stringify(plan, null, 2));
  writeFileSync("matrix.json", JSON.stringify(bins.map((_, i) => i)));
  console.log(`${plan.files} files, ${(plan.totalBytes / 1e9).toFixed(1)} GB compressed, ${bins.length} shards; ${problems.length} problems`);
  for (const p of problems) console.log(`  ! ${p}`);
}

if (process.argv[1]?.endsWith("mrf-plan.ts")) main().catch((e) => { console.error(e); process.exit(1); });
