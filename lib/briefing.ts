import { db } from "./db";
import { AUTO_FILTER_TAG } from "./relevance";
import { bootstrapCutoffs, isNewlyDetected } from "./marketdata/events";

/**
 * The briefing: what's new and why it matters, ranked. News comes from signals; data-detected changes (accounts,
 * filings, negotiated rates, networks) come from MarketEvents and count as new when newly *detected*.
 */
export type BriefItem = {
  id: string; title: string; summary: string | null; href: string; when: Date; competitor: string | null; competitorId: string | null;
  tier: number; importance: number; type: string; kind: string | null; coverage: number; score: number; why: string;
};

type EventData = { participants?: number; from?: string[]; to?: string[]; brokers?: string[]; selfFunded?: boolean; services?: number; median?: number } | null;

const pct = (title: string) => { const m = /([+−-])(\d+(?:\.\d+)?)%/.exec(title); return m ? (m[1] === "+" ? 1 : -1) * Number(m[2]) : null; };

/** One line on why an item matters to someone competing against this carrier. Rule-based: states the implication, not a prediction. */
export function whyItMatters(i: { kind: string | null; type: string; title: string; competitor: string | null; data?: EventData }): string {
  const who = i.competitor ?? "This carrier";
  const d = i.data ?? {};
  switch (i.kind) {
    case "account_lost":
      return d.selfFunded
        ? `The employer moved to self-funding — ${who} may still administer it, but the insured premium is gone. Check who the administrator is.`
        : `${who} lost this group${d.to?.length ? ` to ${d.to.join(" & ")}` : ""}. Worth knowing why: price, network or broker. Similar groups with the same broker may be shopping too.`;
    case "account_won":
      return `${who} took this group${d.from?.length ? ` from ${d.from.join(" & ")}` : ""}${d.brokers?.length ? ` through ${d.brokers[0]}` : ""}. Watch that broker's other accounts at renewal.`;
    case "rate_filing": {
      const p = pct(i.title);
      if (p == null) return `A filed rate change sets ${who}'s street price for the year.`;
      return p >= 8 ? `A ${p.toFixed(0)}% increase pushes ${who}'s members to shop at renewal — a pricing opening if you filed lower.`
        : p <= -2 ? `${who} is cutting price. Expect pressure on your renewals in this segment.`
        : `A modest change: ${who} is holding position on price in this segment.`;
    }
    case "rate_change": {
      const up = /\bup\b/.test(i.title);
      return up ? `${who} is paying this provider more. That cost reaches its premiums at the next renewal cycle — and tells you what the provider may ask of you.`
        : `${who} negotiated this provider down. If your rate there didn't move, your cost position just got worse.`;
    }
    case "network_drop":
      return `If this is a real termination, ${who}'s members who use this hospital must switch or pay more — a direct sales opening nearby. Confirm before acting.`;
    case "network_add":
      return `${who} closed a gap in its network. If you sold against that gap, the argument is gone.`;
  }
  switch (i.type) {
    case "PRICING": return `Pricing moves change who wins at renewal. Compare against your own position in the same segment.`;
    case "PRODUCT": return `A new or changed product shifts what brokers can quote against you.`;
    case "NETWORK": return `Network changes move members and change what the plan costs to run.`;
    case "M_AND_A": return `Deals change scale, capital and focus — and distract the people doing them.`;
    case "LEADERSHIP": return `New leaders usually mean a strategy change within a year.`;
    case "PARTNERSHIP": return `Partnerships show where ${who} is trying to add capability it doesn't have.`;
    case "FINANCIAL": return `Financial results set how aggressive ${who} can afford to be on price.`;
    case "REGULATORY": return `Regulatory actions constrain ${who}'s options — and may apply to you too.`;
    default: return `Tagged to ${who}; no specific implication detected.`;
  }
}

/** Stock-quote pages and analyst rating notes get classified as pricing or financial news; they aren't competitive moves. */
export const MARKET_NOISE = /stock price|share price|price target|buy rating|sell rating|hold rating|outperform|underperform|\b(nyse|nasdaq)\b|stock quote|quote & history|\(\w{2,5}\.us\)|shares (rise|fall|jump|slip|drop)|moomoo|marketbeat|seeking alpha|\bstocks?\b|target price|stock price|\bquote\b|moomoo|yahoo! finance|ad-hoc-news|barron's|simply wall st|tradingview|investing\.com|yahoo finance|zacks|motley fool|fair value|earnings call transcript|call is live|stock (may|could|is)\b|(stock|shares) (tumbles|soars|climbs|sinks|plunges)/i;

const KINDS = ["account-won", "account-lost", "rate-filing", "rate-change", "network-add", "network-drop"];

export async function briefing(workspaceId: string, days = 7) {
  const since = new Date(Date.now() - days * 864e5);
  const include = { tags: { include: { tag: true } }, competitor: { select: { id: true, name: true, tier: true } }, _count: { select: { coverage: true } } } as const;
  const live = { workspaceId, duplicateOfId: null, status: { not: "ARCHIVED" as const }, NOT: { tags: { some: { tag: { name: AUTO_FILTER_TAG } } } } };
  const [competitors, cutoffs, recentEvents, news] = await Promise.all([
    db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, tier: true }, orderBy: [{ tier: "asc" }, { name: "asc" }] }),
    bootstrapCutoffs(),
    db.marketEvent.findMany({ where: { createdAt: { gte: since } }, select: { title: true, kind: true, createdAt: true, occurredAt: true, data: true } }),
    // News: anything that isn't a data-detected change.
    db.signal.findMany({ where: { ...live, createdAt: { gte: since }, tags: { none: { tag: { name: "market-data" } } } }, include, orderBy: [{ importance: "desc" }, { createdAt: "desc" }], take: 1500 }),
  ]);
  // Data-detected changes: only those newly detected in the window (the bulk first load is history, and is never fetched).
  const events = recentEvents.filter((e) => isNewlyDetected(e, cutoffs, days * 864e5));
  const eventByTitle = new Map(events.map((e) => [e.title, e]));
  const data = events.length ? await db.signal.findMany({ where: { ...live, title: { in: events.map((e) => e.title) }, tags: { some: { tag: { name: "market-data" } } } }, include, take: 1500 }) : [];
  const signals = [...data, ...news];

  const items: BriefItem[] = [];
  let noise = 0;
  for (const s of signals) {
    const kindTag = s.tags.map((t) => t.tag.name).find((n) => KINDS.includes(n));
    const isData = s.tags.some((t) => t.tag.name === "market-data");
    const ev = isData ? eventByTitle.get(s.title) : undefined;
    // Back-history loaded in bulk isn't news; it stays on the Changes page.
    if (isData && (!ev || !isNewlyDetected(ev, cutoffs, days * 864e5))) continue;
    if (!isData && (s.publishedAt ?? s.createdAt) < since) continue;
    if (!isData && MARKET_NOISE.test(s.title)) { noise++; continue; }
    const tier = s.competitor?.tier ?? 3;
    const kind = kindTag ? kindTag.replace("-", "_") : null;
    // Within a kind, bigger moves rank higher: size of the rate change, people in the account; network changes outrank both.
    const d = (ev?.data ?? null) as EventData;
    const magnitude = !kind ? 0 : kind.startsWith("network") ? 1.5 : kind === "rate_change" ? Math.min(1, Math.abs(d?.median ?? 0) * 3) : kind.startsWith("account") ? Math.min(1, (d?.participants ?? 0) / 2000) : 0;
    const score = magnitude + s.importance + (tier === 1 ? 1 : tier === 3 ? -0.5 : 0) + Math.min(s._count.coverage, 3) * 0.3 + (isData ? 0.5 : 0) + (s.status === "ESCALATED" ? 1 : 0) + (s.competitor ? 0 : -1);
    items.push({
      id: s.id, title: s.title, summary: s.summary, href: `/signals/${s.id}`, when: isData ? ev!.createdAt : s.publishedAt ?? s.createdAt,
      competitor: s.competitor?.name ?? null, competitorId: s.competitor?.id ?? null, tier, importance: s.importance, type: s.type, kind, coverage: s._count.coverage, score,
      why: whyItMatters({ kind, type: s.type, title: s.title, competitor: s.competitor?.name ?? null, data: (ev?.data ?? null) as EventData }),
    });
  }
  items.sort((a, b) => b.score - a.score || b.when.getTime() - a.when.getTime());

  // Top five: best-ranked, at most two per competitor so one noisy carrier can't own the list.
  const top: BriefItem[] = [];
  const perComp = new Map<string, number>();
  for (const it of items) {
    const k = it.competitorId ?? "_";
    if ((perComp.get(k) ?? 0) >= 2) continue;
    perComp.set(k, (perComp.get(k) ?? 0) + 1);
    top.push(it);
    if (top.length === 5) break;
  }
  const byCompetitor = competitors
    .map((c) => {
      const mine = items.filter((i) => i.competitorId === c.id);
      return { ...c, count: mine.length, major: mine.filter((i) => i.importance >= 4).length, items: mine.slice(0, 3) };
    })
    .filter((c) => c.count > 0)
    .sort((a, b) => a.tier - b.tier || (b.items[0]?.score ?? 0) - (a.items[0]?.score ?? 0));
  // Every competitor appears: quiet ones with when they last had any activity.
  const lastSeen = await db.signal.groupBy({ by: ["competitorId"], where: { workspaceId, competitorId: { in: competitors.map((c) => c.id) } }, _max: { createdAt: true } });
  const quiet = competitors.filter((c) => !byCompetitor.some((x) => x.id === c.id))
    .map((c) => ({ id: c.id, name: c.name, tier: c.tier, last: lastSeen.find((l) => l.competitorId === c.id)?._max.createdAt ?? null }));
  return { since, days, items, total: items.length, major: items.filter((i) => i.importance >= 4).length, dataDetected: items.filter((i) => i.kind).length, noise, top, byCompetitor, quiet };
}


/**
 * Carriers with real business in New England that this workspace doesn't track: fully insured covered lives from the
 * latest CMS loss-ratio filings (all segments), grouped by parent where known, minus anything a competitor's filing-name
 * pattern already matches.
 */
export async function untrackedCarriers(workspaceId: string, limit = 10) {
  const { canonicalCarrier } = await import("./marketdata/events");
  const { issuerPatternFor } = await import("./marketdata/queries");
  const competitors = await db.competitor.findMany({ where: { workspaceId }, select: { name: true, aliases: true, issuerPattern: true } });
  const res = competitors.flatMap((c) => { try { return [new RegExp(issuerPatternFor(c), "i")]; } catch { return []; } });
  const latest = await db.marketFinancial.aggregate({ _max: { year: true } });
  const year = latest._max.year;
  if (!year) return [];
  const rows = await db.marketFinancial.groupBy({ by: ["company", "state"], where: { year, state: { in: ["MA", "CT", "RI", "NH", "VT", "ME"] } }, _sum: { coveredLives: true } });
  const by = new Map<string, { name: string; lives: number; states: Set<string>; legal: Set<string> }>();
  for (const r of rows) {
    if (res.some((re) => re.test(r.company))) continue;
    const name = canonicalCarrier(r.company) ?? r.company.replace(/,?\s+(inc|co|company|corporation|corp)\.?$/i, "").trim();
    const x = by.get(name) ?? by.set(name, { name, lives: 0, states: new Set(), legal: new Set() }).get(name)!;
    x.lives += r._sum.coveredLives ?? 0;
    x.states.add(r.state);
    x.legal.add(r.company);
  }
  return [...by.values()].filter((x) => x.lives >= 2000 && !/dental|vision|life insurance|delta/i.test(x.name))
    .sort((a, b) => b.lives - a.lives).slice(0, limit)
    .map((x) => ({ name: x.name, lives: Math.round(x.lives), states: [...x.states].sort(), legal: [...x.legal].slice(0, 3), year }));
}
