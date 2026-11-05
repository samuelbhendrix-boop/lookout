import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { RateReducer, type ReduceOpts, type ReduceResult } from "./reduce";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; LookoutBot; +https://github.com/samuelbhendrix-boop/lookout)" };

/**
 * Open one or more rate-file parts — URLs or local paths; .json, .json.gz or .zip — and reduce them together.
 * Gzip and JSON stream straight from the network; zips (which need random access) are spooled to a temp file.
 */
export async function reduceSources(srcs: string[], opts: Omit<ReduceOpts, "gzip"> = {}): Promise<ReduceResult> {
  const reducer = new RateReducer(opts);
  let zipBytes = 0;
  for (const src of srcs) {
    const remote = /^https?:\/\//.test(src);
    const path = src.split("?")[0].toLowerCase();
    if (path.endsWith(".zip")) {
      const dir = await mkdtemp(join(tmpdir(), "mrf-"));
      try {
        let file = src;
        if (remote) {
          file = join(dir, "rates.zip");
          const res = await fetch(src, { headers: UA, signal: AbortSignal.timeout(60 * 60_000) });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${src.split("?")[0].slice(0, 160)}`);
          await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
        }
        zipBytes += (await stat(file)).size;
        await reducer.consume(await openZipEntry(file), false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      continue;
    }
    let input: Readable;
    if (remote) {
      const res = await fetch(src, { headers: UA, signal: AbortSignal.timeout(6 * 60 * 60_000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${src.split("?")[0].slice(0, 160)}`);
      input = Readable.fromWeb(res.body as never);
    } else input = createReadStream(src, { highWaterMark: 1 << 20 });
    await reducer.consume(input, path.endsWith(".gz"));
  }
  const r = reducer.finish();
  // Zip entries stream decompressed; report the download size instead.
  if (zipBytes) r.stats.compressedBytes = zipBytes + (srcs.some((x) => !x.split("?")[0].toLowerCase().endsWith(".zip")) ? r.stats.compressedBytes : 0);
  return r;
}

export const reduceSource = (src: string, opts: Omit<ReduceOpts, "gzip"> = {}) => reduceSources([src], opts);

/** Stream of the largest .json entry in a zip. */
function openZipEntry(file: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("zip open failed"));
      let best: yauzl.Entry | null = null;
      zip.on("entry", (e: yauzl.Entry) => {
        if (/\.json$/i.test(e.fileName) && (!best || e.uncompressedSize > best.uncompressedSize)) best = e;
        zip.readEntry();
      });
      zip.on("end", () => {
        if (!best) return reject(new Error("no .json entry in zip"));
        zip.openReadStream(best, (e2, s) => {
          if (e2 || !s) { zip.close(); return reject(e2 ?? new Error("entry open failed")); }
          s.on("end", () => zip.close());
          s.on("error", () => zip.close());
          resolve(s);
        });
      });
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}
