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

// ── New England scope for national carriers ────────────────────────────────────────────────────────────────────────
/** Places, regulators and exchanges that put a story in New England. Ambiguous names (Portland, Springfield,
 *  Manchester, Concord) only count with their state. */
const NEW_ENGLAND = /\b(massachusetts|connecticut|rhode island|new hampshire|vermont|maine|new england|boston|worcester|lowell|cambridge,? ma|providence|hartford|new haven|stamford|bridgeport|bangor|augusta,? me|nashua|burlington,? vt|montpelier|cape cod|berkshires?|portland,? (me|maine)|springfield,? (ma|mass)|manchester,? (nh|new hampshire)|concord,? (nh|new hampshire)|health connector|connectorcare|masshealth|access health ct|healthsource ri|coverme|vermont health connect|mass\.|conn\.|r\.i\.|n\.h\.|chia|beacon hill)\b/i;
/** National commercial-strategy moves worth keeping wherever they happen: entering, leaving or launching in the
 *  exchange, employer or ICHRA business. */
const NATIONAL_COMMERCIAL_MOVE = /\b(exit\w*|withdraw\w*|pull\w* out|leav\w*|enter\w*|expand\w*|launch\w*|new plans?|drop\w*)\b[^.]{0,80}\b(aca|obamacare|exchanges?|marketplaces?|individual market|small[- ]group|employer|commercial|ichra|choice arrangement)\b|\b(aca|obamacare|exchanges?|marketplaces?|individual market|ichra)\b[^.]{0,80}\b(exit\w*|withdraw\w*|pull\w* out|leav\w*|enter\w*|expan\w*|launch\w*)\b/i;
export const OUTSIDE_REGION_TAG = "outside-new-england";

/** Health-insurance context: guards against name collisions ("national anthem" for Anthem) from regional outlets. */
const HEALTH = /\b(health|insur\w*|medic\w*|hospital\w*|plans?|coverage|benefits?|members?|patients?|pharm\w*|drugs?|aca|obamacare|premiums?|employers?|clinic\w*|physicians?|doctors?|care)\b/i;
/** Investor coverage: never regional news, even from a regional outlet. */
const INVESTOR = /\b(stock|shares|holders|investors?|price target|buy rating|sell rating|earnings call|eps|guidance|nyse|nasdaq|run-up|\d+% run)\b/i;

/** For a carrier whose news is scoped to New England: does this story qualify? */
export function regionRelevant(text: string): boolean {
  const title = text.split("\n")[0];
  if (INVESTOR.test(title) || !HEALTH.test(text)) return false;
  return NEW_ENGLAND.test(text) || NATIONAL_COMMERCIAL_MOVE.test(text);
}

/** National carriers get New England-only news by default. */
export const NATIONAL_CARRIER = /unitedhealth|united healthcare|cigna|aetna|cvs|elevance|anthem|centene|ambetter|molina|humana|oscar|kaiser|hcsc|health care service/i;
export const defaultNewsScope = (name: string) => (NATIONAL_CARRIER.test(name) ? "region" : "all");
