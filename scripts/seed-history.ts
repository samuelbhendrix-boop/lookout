/**
 * Build a rate-history seed for an earlier month from a carrier's still-published older file, so month-over-month
 * change detection has something to compare against without waiting a month.
 *
 *   npx tsx scripts/seed-history.ts <snapshot file in data/rates> <YYYY-MM> <url> [more part urls]
 *
 * Keeps exactly the providers in the current snapshot (so the two months are comparable) and writes
 * data/rates/history/<month>-<carrier>.json.gz, loaded by the importer when that carrier has no rows for the month.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { reduceSources } from "../lib/marketdata/mrf/source";
import type { Snapshot } from "../lib/marketdata/mrf/files";

const DOLLAR = ["negotiated", "fee schedule", "derived"];
async function main() {
  const [file, month, ...urls] = process.argv.slice(2);
  const snap = JSON.parse(gunzipSync(readFileSync(`data/rates/${file}`)).toString("utf8")) as Snapshot;
  const tins = new Set(snap.rows.map((r) => r.tin));
  const r = await reduceSources(urls, { tins });
  const best = new Map<string, (typeof r.rows)[number]>();
  for (const x of r.rows) {
    if (!tins.has(x.tin) || !x.n || !DOLLAR.includes(x.negotiatedType) || !["institutional", "professional"].includes(x.billingClass)) continue;
    const k = `${x.codeType}\t${x.code}\t${x.billingClass}\t${x.tin}`;
    const cur = best.get(k);
    if (!cur || DOLLAR.indexOf(x.negotiatedType) < DOLLAR.indexOf(cur.negotiatedType)) best.set(k, x);
  }
  const rows = [...best.values()].map((x) => [x.codeType, x.code, x.billingClass, x.tin, x.median]);
  mkdirSync("data/rates/history", { recursive: true });
  const out = `data/rates/history/${month}-${snap.carrier}.json.gz`;
  writeFileSync(out, gzipSync(JSON.stringify({ carrier: snap.carrier, carrierName: snap.carrierName, month, url: urls[0].split("?")[0], lastUpdated: r.meta.lastUpdated, rows })));
  console.log(out, rows.length, "rows", `${Math.round(r.stats.seconds)}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
