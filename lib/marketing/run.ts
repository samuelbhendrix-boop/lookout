import { db } from "../db";
import { crawlSite } from "./crawl";
import { SITES, type ProductSite } from "./sites";

/** Bump when the crawl's reach changes (limits, document rules, starting pages), so the next worker tick re-crawls at once instead of waiting out the month. */
const CRAWL_VERSION = 2;

const norm = (l: string) => l.toLowerCase().replace(/\s+/g, " ").trim();
/**
 * What changed between two wordings of a page, as whole lines added and removed. Lines that only moved, short
 * fragments (menus, buttons) and lines that differ only in digits (dates, counters) are ignored.
 */
export function wordingDiff(before: string, after: string): { added: string[]; removed: string[] } {
  const key = (l: string) => norm(l).replace(/\d+/g, "#");
  const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter((l) => l.length >= 30);
  const a = lines(before), b = lines(after);
  const inA = new Set(a.map(key)), inB = new Set(b.map(key));
  const pick = (xs: string[], other: Set<string>) => [...new Set(xs.filter((l) => !other.has(key(l))))].slice(0, 40).map((l) => l.slice(0, 500));
  return { added: pick(b, inA), removed: pick(a, inB) };
}

/**
 * Crawl each carrier's product marketing and keep what changed. When a page's wording changes, the earlier wording
 * is kept with the lines added and removed. Pages the crawl no longer reaches are dropped (only
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
      const prev = await db.productPage.findUnique({ where: { url: p.url }, select: { hash: true, text: true, title: true, kind: true, changedAt: true } });
      const now = new Date();
      if (!prev || prev.hash !== p.hash) changed++;
      // Keep the earlier wording when it really changed (not when we simply kept more of a long page than before).
      if (prev && prev.hash !== p.hash && !p.text.startsWith(prev.text.slice(0, 15_000))) {
        const d = wordingDiff(prev.text, p.text);
        if (d.added.length || d.removed.length) await db.productPageVersion.create({ data: { site: site.key, url: p.url, title: prev.title, kind: prev.kind, text: prev.text, hash: prev.hash, firstSeenAt: prev.changedAt, added: d.added, removed: d.removed } });
      }
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
    const mark = await db.rateFile.findUnique({ where: { id: "cache:marketing-crawl" }, select: { stats: true } });
    const outdated = (mark?.stats as { v?: number } | null)?.v !== CRAWL_VERSION;
    if (!last || outdated || Date.now() - last.getTime() > 30 * 864e5) {
      log(`[marketing] crawling carrier product sites${outdated && last ? " (the crawl's reach changed)" : ""}`);
      await crawlProductSites(undefined, log);
      const data = { carrier: "_cache", carrierName: "_cache", network: "marketing-crawl", url: "", status: "cache", stats: { v: CRAWL_VERSION }, processedAt: new Date() };
      await db.rateFile.upsert({ where: { id: "cache:marketing-crawl" }, create: { id: "cache:marketing-crawl", ...data }, update: data });
    }
    const { marketingFor } = await import("./extract");
    for (const s of sitesForCrawl()) {
      const before = await db.rateFile.findUnique({ where: { id: `cache:marketing:${s.key}` }, select: { processedAt: true } });
      const m = await marketingFor(s.key).catch((e) => { log(`[marketing] ${s.key} read failed: ${(e as Error).message}`); return null; });
      const after = await db.rateFile.findUnique({ where: { id: `cache:marketing:${s.key}` }, select: { processedAt: true } });
      if (m && after?.processedAt?.getTime() !== before?.processedAt?.getTime()) log(`[marketing] ${s.key}: read ${m.products.length} products`);
    }
    // Daily: note products and networks seen for the first time (large-group launch detection).
    if (Date.now() - lastSighting > 864e5) {
      lastSighting = Date.now();
      const { recordSightings, classifyLaunchNews } = await import("../reports/lglaunches");
      const r = await recordSightings();
      log(`[launches] recorded ${r.marketed} marketed group products and ${r.networks} networks`);
      for (const w of await db.workspace.findMany({ select: { id: true } })) { const n = await classifyLaunchNews(w.id).catch(() => 0); if (n) log(`[launches] judged ${n} headlines`); }
    }
  } finally { busy = false; }
}
let lastSighting = 0;
