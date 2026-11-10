import { createHash } from "node:crypto";
import { db } from "./db";
import { claudeText } from "./ai";
import { AUTO_FILTER_TAG, OUTSIDE_REGION_TAG, mentions, regionRelevant } from "./relevance";
import { MARKET_NOISE } from "./briefing";

/**
 * Competitor commercial-product news: new plans and products, exits, benefit and coverage changes, product networks and
 * exchange moves — nothing else. Rule-scored and clustered here; when ANTHROPIC_API_KEY is set, the top items are also
 * synthesized into a short brief (cached, refreshed when the item set changes or after 12 hours).
 */
const ACTION = /\b(launch\w*|introduc\w*|unveil\w*|debut\w*|roll(s|ed|ing)? out|new (plans?|products?|offerings?|networks?|benefits?|options?|tiers?|programs?)|adds? (a |new )?(plans?|benefits?|coverage|products?)|expand\w* (its |into |to |coverage|offerings?|network)|enter\w* (the |a )?(\w+ )?market|exit\w*|withdraw\w*|pull\w* out|discontinu\w*|(stop|end|drop)\w* (offering|coverage|covering|selling)|no longer (offer|cover|sell)|will (offer|cover|sell)|now (offers?|covers?)|redesign\w*|revamp\w*|overhaul\w*)\b/i;
const PRODUCT_THING = /\b(plans?|products?|portfolio|digital (health|experience|tools?)|member app|HMO|PPO|EPO|POS|tiered|narrow network|network|virtual[- ]first|ICHRA|level[- ]funded|HSA|high[- ]deductible|centers? of excellence|GLP-1|weight[- ]loss|obesity|formulary|pharmacy benefit|primary care|value[- ]based|benefits?|coverage|copay|deductible|telehealth|behavioral health|fertility|IVF)\b/i;
const COMMERCIAL = /\b(employer\w*|commercial|small[- ](business|group|employers?)|large[- ]group|self[- ]funded|individual (market|plans?)|exchange|marketplace|ACA|Health Connector|ConnectorCare|Access Health CT|HealthSource RI|CoverME|Vermont Health Connect|NH Health Insurance Marketplace|open enrollment|members?)\b/i;
const NOT_COMMERCIAL = /\b(Medicare Advantage|MA plans?|Part D|Medigap|Medicaid|MassHealth|RIte Care|dual[- ]eligible|D-SNP|SNP|PACE|retiree)\b/i;
const NOT_PRODUCT = /\b(lawsuit|sues|sued|settle\w*|verdict|earnings|quarter(ly)? results|revenue|profit|guidance|shares|stock|analyst|layoffs?|job cuts|appoint\w*|names? .{0,40}(CEO|president|officer|chief)|steps down|retire\w* as|cyber\w*|breach|hack\w*|outage|investigation|probe|fine[ds]?|penalt\w*)\b/i;
const NE = /\b(Massachusetts|Connecticut|Rhode Island|New Hampshire|Vermont|Maine|New England|Boston|Worcester|Hartford|Providence)\b/i;

export const THEMES = [
  { id: "exit", label: "Exits & withdrawals", re: /\b(exit\w*|withdraw\w*|pull\w* out|discontinu\w*|(stop|end|drop)\w* (offering|coverage|covering|selling)|no longer)\b/i },
  { id: "benefit", label: "Benefits & coverage", re: /\b(GLP-1|weight[- ]loss|obesity|formulary|pharmacy|fertility|IVF|behavioral|mental health|copay|deductible|coverage of|covers?)\b/i },
  { id: "network", label: "Network products", re: /\b(tiered|narrow|network|centers? of excellence|value[- ]based|primary care)\b/i },
  { id: "launch", label: "New plans & products", re: /./ },
] as const;

export type ProductItem = { id: string; title: string; summary: string | null; url: string | null; competitor: string; competitorId: string; when: Date; outlets: number; score: number; theme: (typeof THEMES)[number]["label"]; regional: boolean };

/** Score a story for "a competitor changed a commercial product". Null = not that kind of story. */
export function productScore(title: string, summary = ""): { score: number; theme: ProductItem["theme"]; regional: boolean } | null {
  const text = `${title}\n${summary}`;
  if (MARKET_NOISE.test(title) || NOT_PRODUCT.test(title)) return null;
  if (!ACTION.test(text) || !PRODUCT_THING.test(text)) return null;
  const commercial = COMMERCIAL.test(text);
  // Government-program news counts only when the story is also about commercial business.
  if (NOT_COMMERCIAL.test(title) && !commercial) return null;
  if (NOT_COMMERCIAL.test(text) && !commercial) return null;
  const regional = NE.test(text);
  // Must be about commercial business or New England; national product news with neither is out of scope.
  if (!commercial && !regional) return null;
  let score = 3 + (commercial ? 2 : 0) + (regional ? 2 : 0) + (ACTION.test(title) ? 1 : 0);
  // A provider leaving or joining a carrier's network is a network change, not a product exit.
  const theme = /\bnetwork\b/i.test(text) && /\b(exit\w*|leav\w*|join\w*|drop\w*|contract)\b/i.test(text) ? "Network products" : THEMES.find((t) => t.re.test(text))!.label;
  if (theme === "Exits & withdrawals") score += 1;
  return { score, theme, regional };
}

export async function productNews(workspaceId: string, days = 90, limit = 12, competitorId?: string): Promise<ProductItem[]> {
  const since = new Date(Date.now() - days * 864e5);
  const rows = await db.signal.findMany({
    // Includes stories the feed filter archived automatically (mostly ones already over 30 days old when first
    // fetched): the product test below is stricter than the feed's. Stories a person archived stay out.
    where: {
      workspaceId, duplicateOfId: null, competitorId: competitorId ?? { not: null },
      AND: [
        { tags: { none: { tag: { name: "market-data" } } } },
        { OR: [{ status: { not: "ARCHIVED" } }, { tags: { some: { tag: { name: AUTO_FILTER_TAG } } } }] },
      ],
      OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }],
    },
    include: { competitor: { select: { id: true, name: true, tier: true, aliases: true, newsScope: true } }, _count: { select: { coverage: true } }, tags: { select: { tag: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" }, take: 3000,
  });
  const out: ProductItem[] = [];
  for (const s of rows) {
    const r = productScore(s.title, s.summary ?? "");
    if (!r) continue;
    if (s.status === "ARCHIVED") {
      // Auto-archived: only if it really names the carrier and, for New England-scoped carriers, touches the region.
      const text = `${s.title}\n${s.summary ?? ""}`;
      if (!mentions(text, s.competitor!)) continue;
      if (s.tags.some((t) => t.tag.name === OUTSIDE_REGION_TAG) || (s.competitor!.newsScope === "region" && !regionRelevant(text))) continue;
    }
    const ageDays = (Date.now() - (s.publishedAt ?? s.createdAt).getTime()) / 864e5;
    const score = r.score + Math.min(s._count.coverage, 4) * 0.5 + (s.importance - 2) * 0.5 + (s.competitor!.tier === 1 ? 1 : 0) - ageDays / 45;
    out.push({ id: s.id, title: s.title, summary: s.summary, url: s.url, competitor: s.competitor!.name, competitorId: s.competitor!.id, when: s.publishedAt ?? s.createdAt, outlets: s._count.coverage + 1, score, theme: r.theme, regional: r.regional });
  }
  // One story per competitor per near-identical headline (wire rewrites slip past clustering).
  const seen = new Set<string>();
  return out.sort((a, b) => b.score - a.score).filter((x) => {
    const k = `${x.competitorId}|${x.title.toLowerCase().replace(/[^a-z ]/g, "").split(" ").filter((w) => w.length > 3).slice(0, 5).join(" ")}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, limit);
}

// ── Synthesis (optional: needs ANTHROPIC_API_KEY) ─────────────────────────────────────────────────────────────────
export type Brief = { points: Array<{ text: string; ids: string[] }>; generatedAt: string; model: string } | null;

export async function productBrief(workspaceId: string, items: ProductItem[]): Promise<Brief> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || items.length < 2) return null;
  const top = items.slice(0, 15);
  const hash = createHash("sha1").update(top.map((i) => i.id).join(",")).digest("hex").slice(0, 16);
  const id = `cache:product-brief:${workspaceId}`;
  const cached = await db.rateFile.findUnique({ where: { id } });
  const c = cached?.stats as { hash?: string; brief?: Brief } | null;
  if (c?.hash === hash && c.brief && Date.now() - new Date(c.brief.generatedAt).getTime() < 12 * 3600e3) return c.brief;
  const r = await claudeText({
    label: "product brief", maxTokens: 900,
    system: "You brief a health insurer's competitive-intelligence lead on competitors' COMMERCIAL product changes (employer, small group, individual/exchange) in New England. From the news items given, write 2-4 points on the changes that matter most for competing: new or withdrawn products, plan design or benefit changes, product networks, exchange moves. Ignore anything about Medicare, Medicaid, earnings, stock, lawsuits or executives. Each point: one sentence, plain, specific (carrier, product, where, when), no hype, only facts stated in the items; quote numbers exactly as given. Reply with only JSON: {\"points\":[{\"text\":\"...\",\"ids\":[\"item ids it rests on\"]}]}. Fewer points is fine; none if nothing qualifies.",
    user: top.map((i) => `id: ${i.id}\ncompetitor: ${i.competitor}\ndate: ${i.when.toISOString().slice(0, 10)}\ntitle: ${i.title}\nsummary: ${(i.summary ?? "").slice(0, 500)}`).join("\n\n"),
  });
  if (!r || !r.text.includes("{")) { if (r) console.error("[ai] product brief: no JSON in reply"); return c?.brief ?? null; }
  try {
    const parsed = JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1)) as { points?: Array<{ text: string; ids: string[] }> };
    const valid = new Set(top.map((i) => i.id));
    const brief: Brief = { points: (parsed.points ?? []).filter((p) => p.text && p.ids?.some((x) => valid.has(x))).map((p) => ({ text: p.text, ids: p.ids.filter((x) => valid.has(x)) })).slice(0, 4), generatedAt: new Date().toISOString(), model: r.model };
    const data = { carrier: "_cache", carrierName: "_cache", network: "product-brief", url: "", status: "cache", stats: JSON.parse(JSON.stringify({ hash, brief })), processedAt: new Date() };
    await db.rateFile.upsert({ where: { id }, create: { id, ...data }, update: data });
    return brief;
  } catch (e) {
    console.error(`[ai] product brief: unreadable reply: ${(e as Error).message}`);
    return c?.brief ?? null;
  }
}
