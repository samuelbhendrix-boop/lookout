import { createHash } from "node:crypto";
import { parse, type HTMLElement } from "node-html-parser";

/**
 * Watching a plain web page (a newsroom, press-release list, "about us" or product page) that has no RSS feed.
 *
 *  1. If the page advertises a feed (<link rel="alternate" type="application/rss+xml">), use the feed.
 *  2. Else treat it as a list of articles: every link on the same site whose text reads like a headline. Links not
 *     seen on the previous check are new items. The first check only records what's there (no flood of old items).
 *  3. A page with no headline-like links (a single product or policy page) is watched for text changes instead:
 *     when its main text changes, one item lists the sentences that were added.
 */

export type PageState = { seen?: string[]; hash?: string; sentences?: string[]; mode?: "links" | "text" | "feed"; feed?: string };
export type PageItem = { title: string; url: string; summary: string | null; publishedAt: Date | null };

const MAX_SEEN = 600;
const NAV_TEXT = /^(home|about( us)?|contact( us)?|careers?|log ?in|sign ?(in|up)|search|menu|skip to|privacy|terms|cookie|accessibility|subscribe|read more|learn more|more|next|previous|back|view all|see all|share|facebook|twitter|linkedin|instagram|youtube|x)$/i;
const ARTICLE_PATH = /news|press|release|article|blog|stor(y|ies)|insight|update|announce|media|post|\/20\d\d\//i;
const DATE_RE = /\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2},? 20\d\d|\d{1,2}\/\d{1,2}\/20\d\d|20\d\d-\d\d-\d\d)\b/i;

/** Each text change needs its own URL so it isn't de-duplicated against the previous change (fragments are ignored). */
const withChangeId = (url: string, id: string) => { const u = new URL(url); u.searchParams.set("lookout_change", id); return u.toString(); };
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Feed URL the page advertises, if any. */
export function feedLink(html: string, base: string): string | null {
  const root = parse(html);
  const l = root.querySelectorAll('link[rel~="alternate"]').find((e) => /rss|atom/i.test(e.getAttribute("type") ?? ""));
  const href = l?.getAttribute("href");
  if (!href) return null;
  try { return new URL(href, base).toString(); } catch { return null; }
}

function mainOf(root: HTMLElement): HTMLElement {
  for (const sel of ["header", "footer", "nav", "script", "style", "noscript", "svg", "form", "[role=navigation]", "[aria-hidden=true]", ".cookie", "#cookie"]) for (const e of root.querySelectorAll(sel)) e.remove();
  return root.querySelector("main") ?? root.querySelector("article") ?? root.querySelector("[role=main]") ?? root.querySelector("body") ?? root;
}

/** Headline-like links on the page, in page order, de-duplicated by URL. */
export function articleLinks(html: string, base: string): PageItem[] {
  const main = mainOf(parse(html));
  const host = new URL(base).hostname.replace(/^www\./, "");
  const out = new Map<string, PageItem>();
  for (const a of main.querySelectorAll("a[href]")) {
    let url: URL;
    try { url = new URL(a.getAttribute("href")!, base); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || url.hostname.replace(/^www\./, "") !== host) continue;
    url.hash = "";
    if (url.toString() === new URL(base).toString() || /\.(jpg|png|gif|svg|zip|css|js)$/i.test(url.pathname)) continue;
    if (/\/(search|tag|tags|category|categories|author|page)(\/|$)/i.test(url.pathname) || /[?&](keys|q|s|page|query)=/i.test(url.search)) continue;
    const title = clean(a.querySelector("h1,h2,h3,h4")?.text ?? a.getAttribute("title") ?? a.text).replace(/^(read more( about)?|learn more( about)?|continue reading)[:\s]+/i, "");
    const words = title.split(" ").length;
    if (NAV_TEXT.test(title) || words < 4 || title.length > 220) continue;
    // A headline is either under an article-ish path or several words long with a path at least two segments deep.
    const depth = url.pathname.split("/").filter(Boolean).length;
    const slug = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    const longSlug = slug.split(/[-_]/).length >= 4;
    if (!ARTICLE_PATH.test(url.pathname) && !/20\d\d/.test(url.pathname) && !longSlug && !(words >= 6 && depth >= 2)) continue;
    // Look around the link (its card/list item) for a date and a teaser.
    const card = a.closest("li") ?? a.closest("article") ?? a.parentNode?.parentNode ?? a.parentNode;
    // Space out inline elements so "Headline</a><span>Nov 1" doesn't read as "HeadlineNov 1".
    const around = card ? clean(parse((card as HTMLElement).innerHTML.replace(/</g, " <")).text) : "";
    const date = DATE_RE.exec(around)?.[0];
    const publishedAt = date && !Number.isNaN(Date.parse(date)) ? new Date(date) : null;
    const teaser = clean(around.replace(title, "").replace(date ?? "", "")).slice(0, 400);
    const key = url.toString();
    if (!out.has(key)) out.set(key, { title, url: key, summary: teaser.length > 30 ? teaser : null, publishedAt });
  }
  return [...out.values()];
}

/** Main text of the page, split into sentences (for change detection on non-list pages). */
export function pageSentences(html: string): string[] {
  const blocks = mainOf(parse(html)).structuredText.split(/\n+/);
  return [...new Set(blocks.flatMap((b) => clean(b).split(/(?<=[.!?])\s+(?=[A-Z0-9“"])/)).map(clean).filter((s) => s.length >= 25 && s.length <= 600))];
}

/**
 * Compares the page against what was seen last time. Returns new items and the state to store.
 * `isFirst` → only records the baseline.
 */
export function diffPage(html: string, url: string, prev: PageState, pageTitle?: string): { items: PageItem[]; state: PageState } {
  const links = articleLinks(html, url);
  if (links.length >= 3 && prev.mode !== "text") {
    const seen = new Set(prev.seen ?? []);
    const first = !prev.seen;
    const items = first ? [] : links.filter((l) => !seen.has(l.url));
    const nextSeen = [...new Set([...links.map((l) => l.url), ...(prev.seen ?? [])])].slice(0, MAX_SEEN);
    return { items: items.slice(0, 25), state: { mode: "links", seen: nextSeen } };
  }
  const sentences = pageSentences(html);
  if (sentences.length < 2 && links.length === 0) throw new Error("This page builds its content with JavaScript, so there is nothing to read without a browser. Use the site's RSS feed or a Google News query for it instead.");
  const hash = createHash("sha256").update(sentences.join("\n")).digest("hex");
  if (!prev.hash || prev.hash === hash) return { items: [], state: { mode: "text", hash, sentences: sentences.slice(0, 400) } };
  const before = new Set(prev.sentences ?? []);
  const added = sentences.filter((s) => !before.has(s));
  const removed = (prev.sentences ?? []).filter((s) => !sentences.includes(s));
  if (!added.length && !removed.length) return { items: [], state: { mode: "text", hash, sentences: sentences.slice(0, 400) } };
  const summary = [
    added.length ? `Added: ${added.slice(0, 4).map((s) => `“${s.slice(0, 240)}”`).join(" ")}` : "",
    removed.length ? `Removed: ${removed.slice(0, 2).map((s) => `“${s.slice(0, 160)}”`).join(" ")}` : "",
  ].filter(Boolean).join(" ").slice(0, 2000);
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    items: [{ title: `${pageTitle ?? "Page"} changed (${stamp})`, url: withChangeId(url, hash.slice(0, 10)), summary, publishedAt: new Date() }],
    state: { mode: "text", hash, sentences: sentences.slice(0, 400) },
  };
}

export const titleOf = (html: string) => clean(parse(html).querySelector("title")?.text ?? "").slice(0, 120) || null;
