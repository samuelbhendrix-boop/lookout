import { gunzipSync } from "node:zlib";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { dbSink, type HptFileRecord, type Row } from "./hpt";
import { MRF_REPO } from "./mrfx";

/**
 * Loads the monthly hospital price-file extract (built in GitHub Actions by .github/workflows/hpt-extract.yml) from
 * the newest "hpt-YYYY-MM" release. The heavy part (downloading and parsing multi-gigabyte files) happens there; this
 * only writes the benchmark basket's prices, a few tens of thousands of rows.
 */
const UA = { "User-Agent": "Mozilla/5.0 (compatible; PayersightBot; +https://github.com/samuelbhendrix-boop/lookout)" };
type Release = { tag_name: string; html_url: string; assets: Array<{ name: string; browser_download_url: string }> };

export async function latestHospitalExtract(): Promise<Release | null> {
  const res = await fetch(`https://api.github.com/repos/${MRF_REPO}/releases?per_page=30`, { headers: { ...UA, accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GitHub releases API: HTTP ${res.status}`);
  return ((await res.json()) as Release[]).filter((r) => /^hpt-\d{4}-\d{2}$/.test(r.tag_name) && r.assets.some((a) => /^hpt-\d+\.ndjson\.gz$/.test(a.name))).sort((a, b) => b.tag_name.localeCompare(a.tag_name))[0] ?? null;
}

export async function importHospitalExtract(): Promise<number> {
  const rel = await latestHospitalExtract();
  if (!rel) throw new Error("No hospital price-file extract published yet (GitHub release hpt-YYYY-MM). It runs on the 6th of each month, or start it from the repo's Actions tab.");
  const prev = await db.rateFile.findUnique({ where: { id: "cache:hptx" } });
  if ((prev?.stats as { release?: string } | null)?.release === rel.tag_name) return 0;
  let rows = 0, files = 0;
  for (const a of rel.assets.filter((x) => /^hpt-\d+\.ndjson\.gz$/.test(x.name))) {
    const res = await fetch(a.browser_download_url, { headers: UA, signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok) throw new Error(`${a.name}: HTTP ${res.status}`);
    let buf: Buffer = Buffer.from(await res.arrayBuffer());
    while (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
    for (const line of buf.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      const x = JSON.parse(line) as { id: string; file: HptFileRecord & { processedAt: string }; rows: Row[] | null };
      // A file that failed this month keeps last month's prices (only its status is updated).
      await dbSink.save(x.id, { ...x.file, processedAt: new Date(x.file.processedAt) }, x.rows);
      files++; rows += x.rows?.length ?? 0;
    }
  }
  const data = { carrier: "_cache", carrierName: "_cache", network: "hptx", url: rel.html_url, status: "cache", stats: { release: rel.tag_name, files, rows } as Prisma.InputJsonValue, processedAt: new Date() };
  await db.rateFile.upsert({ where: { id: "cache:hptx" }, create: { id: "cache:hptx", ...data }, update: data });
  return rows;
}
