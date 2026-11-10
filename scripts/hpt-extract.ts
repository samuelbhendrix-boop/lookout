/**
 * Monthly hospital price-file extract (run in GitHub Actions by .github/workflows/hpt-extract.yml, not on the web
 * server: the files run to gigabytes). Processes one shard of the hospital list and writes what the app needs (the
 * benchmark basket's commercial prices, plus each file's status) as JSON lines.
 *   npx tsx scripts/hpt-extract.ts <shard> <shards> <out-dir>
 */
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { HPT_DOMAINS, importHospitalFiles, type HptSink } from "../lib/marketdata/hpt";

(async () => {
  const [shard, shards, out] = [Number(process.argv[2] ?? 0), Number(process.argv[3] ?? 1), process.argv[4] ?? "out"];
  await mkdir(out, { recursive: true });
  const gz = createGzip();
  const done = new Promise<void>((res) => { gz.pipe(createWriteStream(join(out, `hpt-${shard}.ndjson.gz`))).on("finish", () => res()); });
  const domains = HPT_DOMAINS.filter((_, i) => i % shards === shard).map((d) => d.domain);
  let files = 0, rows = 0;
  const sink: HptSink = {
    async save(id, file, r) {
      files++; rows += r?.length ?? 0;
      console.log(`${file.status.padEnd(7)} ${file.domain} ${file.hospital} ${r?.length ?? 0} rows${file.error ? ` — ${file.error}` : ""}`);
      if (!gz.write(JSON.stringify({ id, file, rows: r }) + "\n")) await new Promise((res) => gz.once("drain", res));
    },
  };
  await importHospitalFiles({ domains, force: true, sink });
  gz.end();
  await done;
  console.log(`shard ${shard}/${shards}: ${domains.length} sites, ${files} files, ${rows} rows`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
