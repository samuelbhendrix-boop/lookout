import Parser from "rss-parser";
import { db } from "./db";
import { ingestSignal } from "./signals";
import { safeFetch } from "./net";
import { isStale, withRecency } from "./relevance";
import { diffPage, feedLink, titleOf, type PageItem, type PageState } from "./webpage";
import type { Prisma } from "@prisma/client";

const parser = new Parser();
const UA = {
  "User-Agent": "Mozilla/5.0 (compatible; LookoutBot/0.3; +https://github.com/samuelbhendrix-boop/lookout)",
  accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
};

// ── Politeness: news aggregators throttle bursts from cloud IPs (HTTP 503/429). ──
// One gate per host spaces requests out, so loading 40 Google News feeds at once becomes a
// steady trickle instead of a burst that gets the server's IP rate-limited.
const HOST_GAP_MS: Record<string, number> = { "news.google.com": 4000, "www.bing.com": 2000 };
const DEFAULT_GAP_MS = 500;
const gates = new Map<string, Promise<void>>();
const pending = new Map<string, number>();

/** Requests queued or running for this URL's host in this process. */
export const hostLoad = (url: string) => pending.get(new URL(url).hostname) ?? 0;
export const hostGapMs = (url: string) => HOST_GAP_MS[new URL(url).hostname] ?? DEFAULT_GAP_MS;

/** Thrown when a poll should step aside and be retried later without counting as a failure. */
export class DeferJob extends Error {
  constructor(public delayMs: number) {
    super(`deferred ${delayMs}ms`);
  }
}

export async function politely<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const host = new URL(url).hostname;
  const gap = HOST_GAP_MS[host] ?? DEFAULT_GAP_MS;
  pending.set(host, (pending.get(host) ?? 0) + 1);
  const prev = gates.get(host) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  gates.set(host, prev.then(() => mine));
  await prev;
  try {
    return await fn();
  } finally {
    setTimeout(() => {
      pending.set(host, (pending.get(host) ?? 1) - 1);
      release();
    }, gap);
  }
}

/** Google News RSS search URL → equivalent Bing News RSS URL (same query), else null. */
export function bingFallback(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "news.google.com" || !u.pathname.startsWith("/rss/search")) return null;
    const q = u.searchParams.get("q")?.replace(/\s*\bwhen:\d+[dhmy]\b/g, "").trim();
    return q ? `https://www.bing.com/news/search?format=rss&q=${encodeURIComponent(q)}` : null;
  } catch {
    return null;
  }
}

export class TransientFeedError extends Error {}
const isTransient = (status: number) => status === 429 || status === 502 || status === 503 || status === 504;

/** Fetches feed XML: politely, and falling back from Google News to Bing News when throttled. */
async function fetchFeed(url: string): Promise<string> {
  const res = await politely(url, () => safeFetch(url, { headers: UA }));
  if (res.ok) return res.text;
  if (isTransient(res.status)) {
    const alt = bingFallback(url);
    if (alt) {
      const altRes = await politely(alt, () => safeFetch(alt, { headers: UA }));
      if (altRes.ok) return altRes.text;
    }
    throw new TransientFeedError(`News provider is busy (HTTP ${res.status}) — retrying automatically`);
  }
  throw new Error(`Feed returned HTTP ${res.status}`);
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/**
 * Feeds disagree on shapes: some send titles/links as objects (e.g. CMS sends
 * <title> with attributes → { _: "text", $: {...} }), arrays, or numbers. Coerce to text.
 */
export function textOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return textOf(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o._ != null || o["#text"] != null) return textOf(o._ ?? o["#text"]);
    // Unescaped HTML inside the element (CMS: <title><a href="…">Text</a></title>) → first child's text.
    const child = Object.entries(o).find(([k]) => k !== "$");
    return child ? textOf(child[1]) : "";
  }
  return "";
}

/** First href found in an element that wrapped raw HTML, e.g. CMS's <title><a href="/x">…</a></title>. */
function hrefIn(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  if (Array.isArray(v)) return hrefIn(v[0]);
  const o = v as Record<string, any>;
  if (typeof o.$?.href === "string") return o.$.href;
  for (const [k, child] of Object.entries(o)) if (k !== "$") { const h = hrefIn(child); if (h) return h; }
  return null;
}

/** Item link, repairing feeds that put an HTML anchor where the URL belongs. */
export function linkOf(item: { link?: unknown; title?: unknown }, feedUrl: string): string | null {
  let raw = textOf(item.link).trim();
  try { raw = decodeURIComponent(raw); } catch { /* keep as is */ }
  const anchor = raw.match(/<a\s[^>]*href=["']([^"']+)["']/i)?.[1];
  const candidate = anchor ?? (/[<>]/.test(raw) ? null : raw) ?? hrefIn(item.title);
  const fallback = hrefIn(item.title);
  for (const c of [candidate, fallback]) {
    if (!c) continue;
    try { return new URL(c, feedUrl).toString(); } catch { /* try next */ }
  }
  return null;
}

/** Polls one RSS/Atom source and ingests new items. Returns count of new signals. */
export async function pollSource(sourceId: string): Promise<number> {
  const source = await db.source.findUnique({ where: { id: sourceId } });
  if (!source || !source.enabled || (source.kind !== "RSS" && source.kind !== "WEBPAGE") || !source.url) return 0;
  // Host already busy in this process → step aside (frees the worker slot for other hosts/alerts).
  const load = hostLoad(source.url);
  if (load > 0) throw new DeferJob(hostGapMs(source.url) * (load + 1));

  try {
    if (source.kind === "WEBPAGE") return await pollWebpage(source);
    // Fetch ourselves (SSRF-checked on every redirect hop, size-capped), then parse.
    const feed = await parser.parseString(await fetchFeed(withRecency(source.url)));
    let created = 0;
    // Cap per poll so one firehose feed can't starve the queue.
    for (const item of feed.items.slice(0, 50)) {
      const title = stripHtml(textOf(item.title));
      if (!title) continue;
      const summary = stripHtml(textOf(item.contentSnippet ?? item.content ?? item.summary)).slice(0, 2000);
      const url = linkOf(item, source.url);
      const publishedAt = item.isoDate ? new Date(item.isoDate) : null;
      if (isStale(publishedAt)) continue; // old articles aren't news
      const s = await ingestSignal(source.workspaceId, {
        title,
        url,
        summary: summary || null,
        publishedAt,
        sourceId: source.id,
        // Competitor-specific source → always attribute; general source → let the matcher decide.
        competitorId: source.competitorId ?? undefined,
        origin: source.competitorId ? "competitor-feed" : "market-feed",
      });
      if (s) created++;
    }
    await db.source.update({ where: { id: source.id }, data: { lastPolledAt: new Date(), lastError: null } });
    return created;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.source.update({ where: { id: source.id }, data: { lastPolledAt: new Date(), lastError: msg.slice(0, 500) } });
    throw err;
  }
}

const PAGE_UA = { "User-Agent": UA["User-Agent"], accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" };

/**
 * A plain web page: uses the feed it advertises if any, else new headline links since the last check, else text
 * changes. The first check records a baseline and creates nothing. Sites that refuse bots (403/429/503) are reported,
 * never worked around.
 */
async function pollWebpage(source: { id: string; workspaceId: string; competitorId: string | null; url: string | null; name: string; state: Prisma.JsonValue }): Promise<number> {
  const url = source.url!;
  const prev = (source.state ?? {}) as PageState;
  const res = await politely(url, () => safeFetch(url, { headers: PAGE_UA }));
  if (res.status === 403 || res.status === 401) throw new Error(`The site refuses automated visits (HTTP ${res.status}); Lookout doesn't get around that. Try its RSS feed or a Google News query instead.`);
  if (isTransient(res.status)) throw new TransientFeedError(`Site is busy (HTTP ${res.status}) — retrying automatically`);
  if (!res.ok) throw new Error(`Page returned HTTP ${res.status}`);

  let items: PageItem[] = [];
  let state: PageState;
  const feed = prev.mode === "feed" ? prev.feed! : feedLink(res.text, url);
  if (feed) {
    // The page advertises a feed: read it, but still only report items not seen before.
    const parsed = await parser.parseString(await fetchFeed(feed));
    const all = parsed.items.slice(0, 50).map((i) => ({ title: stripHtml(textOf(i.title)), url: linkOf(i, feed) ?? "", summary: stripHtml(textOf(i.contentSnippet ?? i.content ?? i.summary)).slice(0, 2000) || null, publishedAt: i.isoDate ? new Date(i.isoDate) : null })).filter((i) => i.title && i.url);
    const seen = new Set(prev.seen ?? []);
    items = prev.seen ? all.filter((i) => !seen.has(i.url)) : all.filter((i) => i.publishedAt && !isStale(i.publishedAt));
    state = { mode: "feed", feed, seen: [...new Set([...all.map((i) => i.url), ...(prev.seen ?? [])])].slice(0, 600) };
  } else {
    ({ items, state } = diffPage(res.text, url, prev, source.name || titleOf(res.text) || undefined));
  }
  let created = 0;
  for (const item of items) {
    if (isStale(item.publishedAt)) continue;
    const s = await ingestSignal(source.workspaceId, {
      title: item.title, url: item.url, summary: item.summary, publishedAt: item.publishedAt ?? new Date(), sourceId: source.id,
      competitorId: source.competitorId ?? undefined, origin: source.competitorId ? "competitor-feed" : "market-feed",
    });
    if (s) created++;
  }
  await db.source.update({ where: { id: source.id }, data: { lastPolledAt: new Date(), lastError: null, state: state as Prisma.InputJsonValue } });
  return created;
}

/**
 * Claims RSS sources whose poll interval has elapsed and stamps lastPolledAt in the same
 * statement, so concurrent schedulers never enqueue the same source twice.
 */
export async function claimDueSources(limit = 100) {
  return db.$queryRaw<Array<{ id: string; workspaceId: string }>>`
    UPDATE "Source" SET "lastPolledAt" = (now() AT TIME ZONE 'UTC')
    WHERE id IN (
      SELECT id FROM "Source"
      WHERE enabled AND kind IN ('RSS', 'WEBPAGE')
        AND ("lastPolledAt" IS NULL OR "lastPolledAt" + ("pollMinutes" * interval '1 minute') <= (now() AT TIME ZONE 'UTC'))
      ORDER BY "lastPolledAt" NULLS FIRST
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, "workspaceId"`;
}
