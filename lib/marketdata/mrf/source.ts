import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { reduceRateFile, type ReduceOpts, type ReduceResult } from "./reduce";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; LookoutBot; +https://github.com/samuelbhendrix-boop/lookout)" };

/**
 * Open a rate file — URL or local path; .json, .json.gz or .zip — and reduce it. Gzip and JSON stream straight
 * from the network; zips (which need random access) are spooled to a temp file and deleted afterwards.
 */
export async function reduceSource(src: string, opts: Omit<ReduceOpts, "gzip"> = {}): Promise<ReduceResult> {
  const remote = /^https?:\/\//.test(src);
  const path = src.split("?")[0].toLowerCase();
  if (path.endsWith(".zip")) {
    const dir = await mkdtemp(join(tmpdir(), "mrf-"));
    try {
      let file = src;
      if (remote) {
        file = join(dir, "rates.zip");
        const res = await fetch(src, { headers: UA, signal: AbortSignal.timeout(60 * 60_000) });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${src.slice(0, 120)}`);
        await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
      }
      const entry = await openZipEntry(file);
      const r = await reduceRateFile(entry, { gzip: false, ...opts });
      r.stats.compressedBytes = (await stat(file)).size;
      return r;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const gzip = path.endsWith(".gz");
  let input: Readable;
  if (remote) {
    const res = await fetch(src, { headers: UA, signal: AbortSignal.timeout(6 * 60 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${src.slice(0, 120)}`);
    input = Readable.fromWeb(res.body as never);
  } else input = createReadStream(src, { highWaterMark: 1 << 20 });
  return reduceRateFile(input, { gzip, ...opts });
}

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
