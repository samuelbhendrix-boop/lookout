import { matchCompetitor } from "./match";

/**
 * Feed hygiene. News search feeds return their best matches from *all time* and anything that
 * loosely matches the query, so every item is checked before it reaches the feed:
 *  - older than MAX_ARTICLE_AGE_DAYS → never ingested (it isn't news)
 *  - from a competitor's own feed but never names that competitor → stored archived ("auto-filtered")
 *  - from a general market feed, about no tracked competitor, and unclassifiable → archived
 * Archived items stay searchable (Status: archived) so nothing is silently lost.
 */
export const MAX_ARTICLE_AGE_DAYS = Number(process.env.MAX_ARTICLE_AGE_DAYS) || 30;

export function isStale(publishedAt: Date | null | undefined, now = Date.now()) {
  return !!publishedAt && now - publishedAt.getTime() > MAX_ARTICLE_AGE_DAYS * 864e5;
}

/** Adds Google News' own recency operator so fresh stories aren't crowded out by old ones. */
export function withRecency(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname !== "news.google.com" || !u.pathname.startsWith("/rss/search")) return url;
    const q = u.searchParams.get("q") ?? "";
    if (/\bwhen:\d+[dhmy]\b/.test(q)) return url;
    u.searchParams.set("q", `${q} when:${MAX_ARTICLE_AGE_DAYS}d`);
    return u.toString();
  } catch {
    return url;
  }
}

/** True when the text actually names the competitor (name or any alias, whole word). */
export function mentions(text: string, c: { id: string; name: string; aliases: string[] }) {
  return matchCompetitor(text, [c]) === c.id;
}

export const AUTO_FILTER_TAG = "auto-filtered";
