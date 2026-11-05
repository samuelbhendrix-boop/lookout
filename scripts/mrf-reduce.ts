/**
 * Reduce any Transparency in Coverage rate file — local path or URL, .json, .json.gz or .zip, any size — to a
 * two small CSVs: key-provider negotiated rates (out.csv) and the network-wide distribution per code (out-summary.csv).
 *
 *   npm run mrf:reduce -- <file-or-url> [out.csv]
 */
import { writeFileSync } from "node:fs";
import { reduceSources } from "../lib/marketdata/mrf/source";
import { toCsv } from "../lib/csv";

async function main() {
  const args = process.argv.slice(2);
  const out = args.find((a) => a.endsWith(".csv")) ?? "rates.csv";
  const srcs = args.filter((a) => !a.endsWith(".csv"));
  if (!srcs.length) { console.error("usage: npm run mrf:reduce -- <file-or-url> [more parts…] [out.csv]"); process.exit(1); }
  const r = await reduceSources(srcs, { onProgress: (b, i) => console.error(`  ${(b / 1e9).toFixed(1)} GB scanned, ${i.toLocaleString()} codes`) });
  const cols = ["code", "codeType", "billingClass", "negotiatedType", "tin", "providerName", "npiCount", "n", "min", "median", "max"] as const;
  writeFileSync(out, toCsv([...cols], r.rows.map((x) => cols.map((c) => x[c]))));
  const sc = ["code", "codeType", "billingClass", "negotiatedType", "providers", "p10", "p25", "p50", "p75", "p90"] as const;
  writeFileSync(out.replace(/(\.csv)?$/, "-summary.csv"), toCsv([...sc], r.summary.map((x) => sc.map((c) => x[c]))));
  console.log(JSON.stringify({ ...r.meta, ...r.stats, MBps: Math.round(r.stats.bytes / 1e6 / r.stats.seconds), rssMB: Math.round(process.memoryUsage().rss / 1e6), out }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
