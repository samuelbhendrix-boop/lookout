import { parse } from "node-html-parser";
import { db } from "./db";
import { siteFor } from "./marketing/sites";

/**
 * Competitor logos: each company's own site icon (apple-touch-icon or the largest declared icon, else favicon),
 * fetched once and stored, so pages never hotlink. Refreshed every 90 days.
 */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAX = 400_000;

export function logoDomain(c: { name: string; website: string | null }): string | null {
  const host = (u: string | null | undefined) => { try { return u ? new URL(u).host.replace(/^www\./, "") : null; } catch { return null; } };
  const w = host(c.website);
  if (w && !/example\.com/.test(w)) return w;
  return host(siteFor(c.name)?.roots[0]);
}

async function get(url: string) {
  try { const r = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15_000) }); return r.ok ? r : null; } catch { return null; }
}

async function image(url: string): Promise<{ data: Buffer; type: string } | null> {
  const r = await get(url);
  if (!r) return null;
  const type = (r.headers.get("content-type") ?? "").split(";")[0].trim();
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || buf.length > MAX) return null;
  const sniff = buf.subarray(0, 4).toString("hex");
  const t = /image\//.test(type) ? type : sniff.startsWith("89504e47") ? "image/png" : sniff.startsWith("ffd8") ? "image/jpeg" : sniff === "00000100" ? "image/x-icon" : /<svg/i.test(buf.subarray(0, 300).toString()) ? "image/svg+xml" : null;
  return t ? { data: buf, type: t } : null;
}

export async function fetchLogo(domain: string): Promise<{ data: Buffer; type: string; source: string } | null> {
  const home = await get(`https://${domain}/`) ?? await get(`https://www.${domain}/`);
  const cands: Array<{ url: string; size: number }> = [];
  if (home) {
    const root = parse(await home.text());
    for (const l of root.querySelectorAll("link")) {
      const rel = (l.getAttribute("rel") ?? "").toLowerCase();
      const href = l.getAttribute("href");
      // Skip leftovers from templates (Fallon's site still declares a pet-vet prototype's touch icons).
      if (!href || !/icon/.test(rel) || /prototype|template|placeholder|sample/i.test(href)) continue;
      const sizes = Number((l.getAttribute("sizes") ?? "").split("x")[0]) || (/apple-touch/.test(rel) ? 180 : /\.svg/i.test(href) ? 256 : 32);
      try { cands.push({ url: new URL(href, home.url).href, size: sizes }); } catch { /* bad href */ }
    }
  }
  cands.sort((a, b) => b.size - a.size);
  for (const c of [...cands, { url: `https://${domain}/favicon.ico`, size: 16 }]) {
    const img = await image(c.url);
    if (img) return { ...img, source: c.url };
  }
  return null;
}

let busy = false;
export async function ensureLogos(log: (m: string) => void = () => {}): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const comps = await db.competitor.findMany({ select: { name: true, website: true } });
    const domains = [...new Set(comps.map(logoDomain).filter(Boolean) as string[])];
    const have = new Map((await db.siteLogo.findMany({ select: { domain: true, fetchedAt: true } })).map((l) => [l.domain, l.fetchedAt]));
    let n = 0;
    for (const d of domains) {
      const at = have.get(d);
      if (at && Date.now() - at.getTime() < 90 * 864e5) continue;
      const l = await fetchLogo(d);
      // Remember a miss too (empty image), so the next pass doesn't retry it for 90 days.
      await db.siteLogo.upsert({ where: { domain: d }, create: { domain: d, contentType: l?.type ?? "none", data: l?.data ?? Buffer.alloc(0), source: l?.source ?? "" }, update: { contentType: l?.type ?? "none", data: l?.data ?? Buffer.alloc(0), source: l?.source ?? "", fetchedAt: new Date() } });
      if (l) n++;
    }
    if (n) log(`logos: fetched ${n}`);
  } finally { busy = false; }
}
