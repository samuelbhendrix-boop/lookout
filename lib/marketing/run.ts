import { db } from "../db";
import { crawlSite } from "./crawl";
import { SITES, type ProductSite } from "./sites";

/**
 * Crawl each carrier's product marketing and keep what changed. Pages the crawl no longer reaches are dropped (only
 * when the crawl itself worked, so a site that is down for a day keeps its last good copy).
 */
export async function crawlProductSites(keys?: string[], log: (m: string) => void = console.log): Promise<Record<string, { pages: number; pdfs: number; changed: number; failed: number }>> {
  const out: Record<string, { pages: number; pdfs: number; changed: number; failed: number }> = {};
  for (const site of SITES.filter((s) => !s.skip && (!keys || keys.includes(s.key)))) {
    const t = Date.now();
    let res: Awaited<ReturnType<typeof crawlSite>>;
    try { res = await crawlSite(site); } catch (e) { log(`[marketing] ${site.key} crawl failed: ${(e as Error).message}`); continue; }
    let changed = 0;
    for (const p of res.pages) {
      const prev = await db.productPage.findUnique({ where: { url: p.url }, select: { hash: true } });
      const now = new Date();
      if (!prev || prev.hash !== p.hash) changed++;
      await db.productPage.upsert({
        where: { url: p.url },
        create: { site: site.key, url: p.url, title: p.title.slice(0, 300), kind: p.kind, text: p.text, score: p.score, hash: p.hash, fetchedAt: now, changedAt: now },
        update: { site: site.key, title: p.title.slice(0, 300), kind: p.kind, text: p.text, score: p.score, hash: p.hash, fetchedAt: now, ...(prev?.hash !== p.hash ? { changedAt: now } : {}) },
      });
    }
    if (res.pages.length >= 3) await db.productPage.deleteMany({ where: { site: site.key, url: { notIn: res.pages.map((p) => p.url) } } });
    out[site.key] = { pages: res.pages.filter((p) => p.kind === "html").length, pdfs: res.pages.filter((p) => p.kind === "pdf").length, changed, failed: res.failed.length };
    log(`[marketing] ${site.key}: ${out[site.key].pages} pages, ${out[site.key].pdfs} PDFs, ${changed} changed, ${res.failed.length} failed (${Math.round((Date.now() - t) / 1000)}s)`);
  }
  return out;
}

export const sitesForCrawl = (): ProductSite[] => SITES.filter((s) => !s.skip);

let busy = false;
/**
 * Monthly: re-crawl carriers' product sites, then re-read any whose pages changed. Also fills in a read that is
 * missing (first run, or the AI key was added later). Runs in the background; one at a time.
 */
export async function maybeRefreshMarketing(log: (m: string) => void): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const { db } = await import("../db");
    const last = (await db.productPage.aggregate({ _max: { fetchedAt: true } }))._max.fetchedAt;
    if (!last || Date.now() - last.getTime() > 30 * 864e5) {
      log("[marketing] crawling carrier product sites");
      await crawlProductSites(undefined, log);
    }
    const { marketingFor } = await import("./extract");
    for (const s of sitesForCrawl()) {
      const before = await db.rateFile.findUnique({ where: { id: `cache:marketing:${s.key}` }, select: { processedAt: true } });
      const m = await marketingFor(s.key).catch((e) => { log(`[marketing] ${s.key} read failed: ${(e as Error).message}`); return null; });
      const after = await db.rateFile.findUnique({ where: { id: `cache:marketing:${s.key}` }, select: { processedAt: true } });
      if (m && after?.processedAt?.getTime() !== before?.processedAt?.getTime()) log(`[marketing] ${s.key}: read ${m.products.length} products`);
    }
  } finally { busy = false; }
}
