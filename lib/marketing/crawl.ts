import { createHash } from "node:crypto";
import { parse, type HTMLElement } from "node-html-parser";
import type { ProductSite } from "./sites";

/**
 * Polite, bounded crawler for carriers' product marketing: product pages, buyer (employer, broker, individual) pages
 * and the PDFs they link (plan summaries, brochures, benefit guides). Plain fetch, one request at a time.
 */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAX_TEXT = 16_000;
const PDF_MAX_BYTES = 15_000_000;

export type CrawledPage = { url: string; title: string; kind: "html" | "pdf"; text: string; score: number; hash: string };

const GOOD = /plan|product|partner|network|virtual|digital|tier|value|select|choice|access|advantage|hmo|ppo|epo|pos\b|hsa|deductible|level-?funded|aso|self-?funded|small|large|group|employer|business|individual|famil|broker|benefit|coverage|connector|exchange|marketplace|shop|compare|ichra|primary-care|aco/gi;
const BAD = /login|log-in|sign-?in|register|careers?|jobs|news|press|blog|article|event|webinar|privacy|terms|legal|accessib|language|contact|faq|search|sitemap|cookie|provider|doctor-finder|find-a-doctor|find-care|pharmacy-?finder|formulary|drug-?list|claims?|payments?|id-?card|forms?\b|login|careers|covid|newsroom|investor|about-us|our-story|community|foundation|espanol|\/es\/|\/es-us\/|\/pt\/|\/zh\//i;
const MEDICAL_OFF = /medicare|medicaid|masshealth|senior|dual|snp\b|dental|vision|hearing|life-insurance|disability|supplemental|travel|pet/i;
const PDF_SBC = /sbc|summary-?of-?benefit|sob\b|schedule-?of-?benefit/i;
const PDF_GOOD = /sbc|summary-?of-?benefit|plan-?summar|benefit-?summar|summary|brochure|overview|guide|highlights|at-a-glance|product|network|plan-?design|sales|portfolio|options|comparison|grid|matrix/i;

export function urlScore(url: string, anchor = ""): number {
  const s = `${url} ${anchor}`;
  return (s.match(GOOD)?.length ?? 0) - (BAD.test(url) ? 5 : 0) - (MEDICAL_OFF.test(url) ? 5 : 0);
}

const clean = (u: string) => { try { const x = new URL(u); x.hash = ""; for (const p of ["icid", "hsLang", "utm_source", "utm_medium", "utm_campaign", "cid"]) x.searchParams.delete(p); return x.href.replace(/\/$/, ""); } catch { return ""; } };

async function get(url: string, timeoutMs = 20_000): Promise<Response | null> {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? r : null;
  } catch { return null; }
}

/** Readable text of an HTML page: main content, headings and list items on their own lines. */
export function htmlText(html: string): { title: string; text: string; root: HTMLElement } {
  const root = parse(html, { blockTextElements: { script: true, style: false, noscript: false, pre: true } });
  const title = (root.querySelector("h1")?.text || root.querySelector("title")?.text || "").replace(/\s+/g, " ").trim();
  const render = (el: HTMLElement) => {
    const clone = parse(el.toString());
    for (const sel of ["script", "style", "noscript", "svg", "header", "footer", "nav", "select", "button", "textarea", "iframe", "[aria-hidden=true]", ".skip-link", "#cookie", ".cookie", ".modal"]) for (const x of clone.querySelectorAll(sel)) x.remove();
    for (const x of clone.querySelectorAll("h1,h2,h3,h4,h5,li,p,tr,dt,dd,br,div,section")) x.insertAdjacentHTML("beforebegin", "\n");
    for (const x of clone.querySelectorAll("h1,h2,h3,h4")) x.insertAdjacentHTML("afterbegin", "## ");
    return clone.text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").split("\n").map((l) => l.trim()).filter((l, i, a) => l && l !== a[i - 1]).join("\n").slice(0, MAX_TEXT);
  };
  const main = root.querySelector("main") ?? root.querySelector("[role=main]");
  const whole = root.querySelector("body") ?? root;
  let text = main ? render(main) : "";
  // A placeholder <main> ("Loading page") with the real copy rendered elsewhere: use the whole body.
  if (text.length < 300) text = render(whole);
  // Client-rendered pages (Oscar): the copy sits in the page's embedded JSON. Pull out its sentences.
  if (text.length < 300) {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const sc of root.querySelectorAll("script")) {
      // React server payloads escape their JSON once more; undo that first.
      const raw = sc.text.includes("__next_f") ? sc.text.replace(/\\"/g, '"') : sc.text;
      for (const m of raw.matchAll(/"((?:[^"\\]|\\.){30,800})"/g)) {
        let v = m[1];
        try { v = JSON.parse(`"${v}"`); } catch { continue; }
        v = v.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (v.split(" ").length < 6 || /[{}=;]|https?:|\.(js|css|png|svg)|function|var\(|px\b/.test(v) || seen.has(v)) continue;
        seen.add(v); lines.push(v);
      }
    }
    if (lines.join(" ").length > text.length) text = lines.join("\n").slice(0, MAX_TEXT);
  }
  return { title, text, root };
}

async function pdfText(buf: ArrayBuffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buf), { verbosity: 0 } as never);
  if (doc.numPages > 60) return "";
  const { text } = await extractText(doc, { mergePages: true });
  return String(text).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").slice(0, MAX_TEXT);
}

const hostOk = (site: ProductSite, u: string) => { try { const h = new URL(u).host; return site.hosts.includes(h) || site.hosts.includes(h.replace(/^www\./, "")) || site.hosts.includes(`www.${h}`); } catch { return false; } };
const isPdf = (u: string) => /\.pdf($|\?)/i.test(u);
/** Last year's (and older) plan-year material: skipped once the current year's is up. */
const stale = (u: string) => { const ys = [...u.matchAll(/(?<!\d)(20[12]\d)(?!\d)/g)].map((m) => Number(m[1])); return ys.length > 0 && Math.max(...ys) < new Date().getUTCFullYear(); };
/** Same document family across plan years and versions: "HMO_Blue_Basic_80-0292CON1-1-27" → "hmo blue basic". */
const family = (u: string) => decodeURIComponent(u.split("/").pop() ?? u).toLowerCase().replace(/\.pdf.*$/, "").replace(/[^a-z]+/g, " ").replace(/\b(con|v|final|eng?|digital|rev|ma|nh|me|ri|ct|vt)\b/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ");

export async function crawlSite(site: ProductSite, log: (m: string) => void = () => {}): Promise<{ pages: CrawledPage[]; failed: string[] }> {
  const maxPages = site.maxPages ?? 35, maxPdfs = site.maxPdfs ?? 12;
  const seen = new Set<string>();
  const queue: { url: string; depth: number; score: number }[] = site.roots.map((u) => ({ url: clean(u), depth: 0, score: 100 }));
  const pdfs = new Map<string, { score: number; anchor: string }>();
  const pages: CrawledPage[] = [];
  const failed: string[] = [];
  const hashes = new Set<string>();
  while (queue.length && pages.filter((p) => p.kind === "html").length < maxPages) {
    queue.sort((a, b) => b.score - a.score || a.depth - b.depth);
    const { url, depth } = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    let r = await get(url);
    if (!r) { failed.push(url); continue; }
    let html = await r.text();
    // Meta-refresh landing pages (Harvard Pilgrim's home page is one).
    const refresh = html.length < 2000 && html.match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i)?.[1];
    if (refresh) { const to = clean(new URL(refresh, r.url).href); if (!seen.has(to)) { seen.add(to); r = await get(to); if (!r) { failed.push(to); continue; } html = await r.text(); } }
    if (!/html/i.test(r.headers.get("content-type") ?? "html")) continue;
    const { title, text, root } = htmlText(html);
    const hash = createHash("sha1").update(text).digest("hex");
    if (text.length > 300 && !hashes.has(hash)) {
      hashes.add(hash);
      pages.push({ url: clean(r.url) || url, title, kind: "html", text, score: urlScore(url), hash });
      log(`  page ${pages.length}: ${url} (${text.length} chars)`);
    }
    for (const a of root.querySelectorAll("a")) {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
      let abs: string; try { abs = clean(new URL(href, r.url).href); } catch { continue; }
      if (!abs.startsWith("http") || seen.has(abs)) continue;
      const anchor = a.text.replace(/\s+/g, " ").trim().slice(0, 120);
      if (stale(abs)) continue;
      if (isPdf(abs)) {
        // PDFs may live on a CDN; keep them if the link sits on a crawled page that lists plan or sales material.
        const docPage = PDF_SBC.test(url) || /marketing|materials|documents|offerings|plans/i.test(url);
        if (!site.exclude?.test(abs) && !MEDICAL_OFF.test(abs) && !/formulary|drug|provider-?directory|claim|form\b|_form|notice|privacy|appeal|grievance|enrollment-?form|application|spanish|espanol|fitness/i.test(abs) && (PDF_GOOD.test(abs) || PDF_GOOD.test(anchor) || docPage)) {
          const prev = pdfs.get(abs);
          pdfs.set(abs, { score: Math.max(prev?.score ?? 0, urlScore(abs, anchor)), anchor: prev?.anchor || anchor });
        }
        continue;
      }
      if (!hostOk(site, abs) || depth >= 2) continue;
      if (site.exclude?.test(abs) || BAD.test(new URL(abs).pathname) || MEDICAL_OFF.test(new URL(abs).pathname)) continue;
      if (site.include && !site.include.test(new URL(abs).pathname)) continue;
      queue.push({ url: abs, depth: depth + 1, score: urlScore(abs, anchor) });
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  // The best-looking PDFs, a few per crawl: plan summaries and brochures carry the product structure.
  // Sales material (brochures, overviews, guides) first, then a few plan summaries (SBCs); one per document family.
  const ranked = [...pdfs.entries()].map(([u, v]) => ({ u, ...v, sbc: PDF_SBC.test(`${u} ${v.anchor}`) })).sort((a, b) => Number(a.sbc) - Number(b.sbc) || b.score - a.score);
  const fams = new Set<string>();
  const pick: string[] = [];
  let sbcs = 0;
  for (const p of ranked) {
    const f = family(p.u);
    if (fams.has(f)) continue;
    if (p.sbc && sbcs >= Math.ceil(maxPdfs / 2)) continue;
    fams.add(f); pick.push(p.u); if (p.sbc) sbcs++;
    if (pick.length >= maxPdfs) break;
  }
  for (const url of pick) {
    const r = await get(url, 40_000);
    if (!r) { failed.push(url); continue; }
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > PDF_MAX_BYTES) continue;
    try {
      const buf = await r.arrayBuffer();
      if (buf.byteLength > PDF_MAX_BYTES) continue;
      const text = await pdfText(buf);
      if (text.length < 300) continue;
      const hash = createHash("sha1").update(text).digest("hex");
      if (hashes.has(hash)) continue;
      hashes.add(hash);
      pages.push({ url, title: decodeURIComponent(url.split("/").pop() ?? url).replace(/\.pdf.*$/i, "").replace(/[-_]+/g, " "), kind: "pdf", text, score: urlScore(url), hash });
      log(`  pdf: ${url} (${text.length} chars)`);
    } catch { failed.push(url); }
  }
  return { pages, failed };
}
