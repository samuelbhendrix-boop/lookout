/**
 * Reduce rate files that can't be fetched by the monthly job (too big for the server, or hosted where only browsers are
 * served) into small snapshots in data/rates/, loaded by the "rates" snapshot import.
 *
 *   npx tsx scripts/build-rate-snapshot.ts <spec.json>
 *
 * spec.json: [{ "file": "bcbsma-hmo-blue", "carrier": "bcbsma", "carrierName": "...", "network": "...", "urls": ["part1", "part2"],
 *              "note": "provenance", "summary": true, "neOnly": false }]
 * Keeps provider detail for TINs already tracked in the database (pass DATABASE_URL) plus each file's own key providers.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { db } from "../lib/db";
import { reduceSources } from "../lib/marketdata/mrf/source";
import type { Snapshot } from "../lib/marketdata/mrf/files";

type Spec = { file: string; carrier: string; carrierName: string; network: string; urls: string[]; note: string; summary?: boolean; onlyTracked?: boolean; skipped?: Snapshot["skipped"] };

async function main() {
  const specs = JSON.parse(readFileSync(process.argv[2], "utf8")) as Spec[];
  // SELECT DISTINCT in SQL: Prisma's `distinct` dedupes in memory after loading every row.
  const tracked = new Set((await db.$queryRaw<Array<{ tin: string }>>`SELECT DISTINCT tin FROM "ProviderRate" WHERE n > 0`).map((r) => r.tin));
  for (const s of specs) {
    const out = `data/rates/${s.file}.json.gz`;
    if (!s.urls.length) {
      writeFileSync(out, gzipSync(JSON.stringify({ carrier: s.carrier, carrierName: s.carrierName, network: s.network, url: "", reportingEntity: null, lastUpdated: null, note: s.note, stats: {}, rows: [], skipped: s.skipped } satisfies Snapshot)));
      console.log(out, "skip list");
      continue;
    }
    const t = Date.now();
    try {
      const r = await reduceSources(s.urls, { tins: tracked });
      const rows = s.onlyTracked ? r.rows.filter((x) => tracked.has(x.tin)) : r.rows;
      rows.forEach((x) => tracked.add(x.tin));
      const snap: Snapshot = {
        carrier: s.carrier, carrierName: s.carrierName, network: s.network, url: s.urls[0].split("?")[0],
        reportingEntity: r.meta.reportingEntity, lastUpdated: r.meta.lastUpdated, note: s.note,
        stats: { ...r.stats, rows: rows.length, parts: s.urls.length }, rows, summary: s.summary === false ? undefined : r.summary,
      };
      writeFileSync(out, gzipSync(JSON.stringify(snap)));
      console.log(out, `${s.urls.length} part(s)`, `${(r.stats.compressedBytes / 1e9).toFixed(2)} GB → ${rows.length} rows`, `${Math.round((Date.now() - t) / 1000)}s`, `rss ${Math.round(process.memoryUsage().rss / 1e6)} MB`);
    } catch (e) {
      console.error(out, "FAILED", (e as Error).message);
    }
  }
  await db.$disconnect();
}
main();
