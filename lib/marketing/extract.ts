import { createHash } from "node:crypto";
import { z } from "zod";
import { claudeJson } from "../ai";
import { db } from "../db";
import { SITES } from "./sites";

/**
 * Reads a carrier's crawled product marketing (web pages, brochures, plan summaries) and pulls out how each commercial
 * product is built and sold: plan type, network model (broad, tiered, limited, system-anchored), whether it is
 * virtual-first, cost design, funding options, who it is aimed at and the pitch, with the pages it came from.
 * Cached until the pages change.
 */
const MODEL = () => process.env.MARKETING_MODEL ?? "claude-sonnet-5-5";
const BUDGET = 110_000; // characters of source text per carrier

const NETWORKS = ["broad", "national", "tiered", "limited", "system-anchored", "regional", "unknown"] as const;
const Partner = z.object({ name: z.string(), role: z.string().nullish(), source: z.string().nullish() });
const Product = z.object({
  name: z.string(),
  family: z.string().nullish(),
  segments: z.array(z.string()).catch([]),
  states: z.array(z.string()).catch([]),
  planType: z.string().nullish(),
  network: z.enum(NETWORKS).catch("unknown"),
  networkDetail: z.string().nullish(),
  virtualFirst: z.boolean().catch(false),
  virtualDetail: z.string().nullish(),
  pcpRequired: z.boolean().nullish().catch(null),
  costDesign: z.array(z.string()).catch([]),
  funding: z.array(z.string()).catch([]),
  targetBuyer: z.string().nullish(),
  pitch: z.string().nullish(),
  claims: z.array(z.string()).catch([]),
  partners: z.array(Partner).catch([]),
  docs: z.array(z.object({ title: z.string(), url: z.string() })).catch([]),
  sources: z.array(z.string()).catch([]),
});
const Result = z.object({
  summary: z.string(),
  structure: z.string().nullish(),
  positioning: z.array(z.string()).catch([]),
  channels: z.string().nullish(),
  gaps: z.string().nullish(),
  partners: z.array(Partner).catch([]),
  // One malformed product shouldn't drop the rest.
  products: z.array(z.unknown()).catch([]).transform((xs) => xs.flatMap((x) => { const r = Product.safeParse(x); return r.success ? [r.data] : []; })),
});
export type MarketedProduct = z.infer<typeof Product>;
export type ProductPartner = z.infer<typeof Partner>;
export type Marketing = z.infer<typeof Result> & { site: string; label: string; generatedAt: string; model: string; pages: number; pdfs: number; crawledAt: string | null };

const SYSTEM = `You are a competitive-intelligence analyst at a New England health insurer. You are given a carrier's own web pages, brochures and plan summaries about its COMMERCIAL medical products (employer group, small business, individual and family). Work out how the carrier structures and markets each product.

Record your answer with the record_products tool, in this shape:
{
  "summary": "3-4 sentences: how the portfolio is built (product families and how they differ) and how the carrier sells it (the main message, who it targets)",
  "structure": "1-2 sentences: the axes the products vary on (network size, plan type, funding, cost sharing)",
  "positioning": ["3-6 short recurring marketing themes, e.g. 'lower premiums through a smaller network'"],
  "channels": "how they sell: brokers, direct, exchange, quoting tools, municipal/union programs, as the pages show",
  "gaps": "anything the pages don't make clear, in one sentence (or null)",
  "partners": [{"name": "vendor or partner company", "role": "what it does for the carrier (virtual primary care, behavioral health, musculoskeletal, centers of excellence, navigation, pharmacy benefit, rental network, health system partner...)", "source": "URL of the page or news item it came from"}],
  "products": [{
    "name": "product or product family as marketed (e.g. 'HMO Blue New England', 'Blue Options', 'Tufts Health Direct')",
    "family": "the family it belongs to, if any",
    "segments": ["individual" | "small group" | "large group" | "self-funded" | "municipal" ...],
    "states": ["MA", "NH", ...],
    "planType": "HMO | PPO | EPO | POS | Open access | mixed",
    "network": one of "broad" | "national" | "tiered" | "limited" | "system-anchored" | "regional" | "unknown",
    "networkDetail": "what the network is: e.g. 'tiered hospitals with lower copays at tier 1', 'limited network built around Mass General Brigham'",
    "virtualFirst": true only if the product is designed around virtual care (virtual PCP, virtual-first entry, lower cost sharing for virtual), not merely if telehealth is covered,
    "virtualDetail": "how virtual care figures in it",
    "pcpRequired": true | false | null,
    "costDesign": ["deductible", "copay-only", "HSA-eligible", "HRA", "coinsurance", "tiered copays", "$0 PCP", "value-based", "reference pricing", ...],
    "funding": ["fully insured", "level-funded", "self-funded (ASO)"],
    "targetBuyer": "who it is aimed at",
    "pitch": "one sentence: how the carrier sells it, in its own framing",
    "claims": ["specific marketing claims, quoted or closely paraphrased, with numbers where given (e.g. 'save up to 20% on premiums')"],
    "partners": [{"name": "vendor or partner named for THIS product (e.g. the virtual-care provider behind a virtual-first plan, the health system a limited network is built on, the network it rents outside its area)", "role": "...", "source": "URL"}],
    "docs": [{"title": "...", "url": "..."}],
    "sources": ["URLs of the pages this came from"]
  }]
}

Rules: use only what the pages say; when something isn't stated, use null or "unknown" rather than guessing. Network "tiered" means cost sharing varies by provider tier; "limited" means a smaller network sold for a lower premium; "system-anchored" means built around one health system or ACO. Medicare, Medicaid, dental, vision and pharmacy-only products are out of scope. Merge plan variants (deductible levels, metal tiers) into their product unless they are marketed as distinct products. Every product needs at least one source URL from the pages given.
Partners: name only companies the pages or NEWS lines actually name as working with the carrier (vendors, health systems, ACOs, digital health companies, PBMs, rental networks, administrators). Put a partner on a product when the material ties it to that product, and also in the top-level "partners" list (every partner, portfolio-wide). Generic program names the carrier owns are not partners. NEWS lines are headlines about the carrier; use them only for partners and cite their URL.`;

function corpus(pages: Array<{ url: string; title: string; kind: string; text: string; score: number }>): string {
  const sorted = [...pages].sort((a, b) => Number(a.kind === "pdf") - Number(b.kind === "pdf") || b.score - a.score);
  const per = Math.max(2500, Math.floor(BUDGET / Math.max(1, sorted.length)));
  let out = "";
  for (const p of sorted) {
    const chunk = `\n\n=== ${p.kind.toUpperCase()} ${p.url}\nTITLE: ${p.title}\n${p.text.slice(0, p.kind === "pdf" ? Math.min(per, 6000) : Math.max(per, 4000))}`;
    if (out.length + chunk.length > BUDGET) continue;
    out += chunk;
  }
  return out;
}

const str = { type: "string" }, strs = { type: "array", items: { type: "string" } };
const partner = { type: "object", properties: { name: str, role: str, source: str }, required: ["name"] };
const SCHEMA = {
  type: "object", required: ["summary", "products"],
  properties: {
    summary: str, structure: str, positioning: strs, channels: str, gaps: str,
    partners: { type: "array", items: partner },
    products: { type: "array", items: { type: "object", required: ["name", "network", "virtualFirst"], properties: {
      name: str, family: str, segments: strs, states: strs, planType: str,
      network: { type: "string", enum: [...NETWORKS] }, networkDetail: str, virtualFirst: { type: "boolean" }, virtualDetail: str,
      pcpRequired: { type: ["boolean", "null"] }, costDesign: strs, funding: strs, targetBuyer: str, pitch: str, claims: strs,
      partners: { type: "array", items: partner }, docs: { type: "array", items: { type: "object", properties: { title: str, url: str }, required: ["title", "url"] } }, sources: strs,
    } } },
  },
};

/** Partnership headlines about the carrier from the news feed (any workspace tracking it), last two years. */
async function partnerNews(match: RegExp): Promise<Array<{ date: string; title: string; url: string }>> {
  const comps = (await db.competitor.findMany({ select: { id: true, name: true } })).filter((c) => match.test(c.name)).map((c) => c.id);
  if (!comps.length) return [];
  const rows = await db.signal.findMany({
    where: { competitorId: { in: comps }, url: { not: null }, publishedAt: { gte: new Date(Date.now() - 730 * 864e5) } },
    select: { title: true, url: true, publishedAt: true }, orderBy: { publishedAt: "desc" }, take: 3000,
  });
  const re = /partner|teams? up|collaborat|alliance|joint venture|selects?\b|chooses|taps\b|contract|agreement|launch(es)? .* with|powered by|acquir|invest/i;
  const seen = new Set<string>();
  return rows.filter((r) => re.test(r.title) && !seen.has(r.title.toLowerCase()) && seen.add(r.title.toLowerCase())).slice(0, 40).map((r) => ({ date: r.publishedAt!.toISOString().slice(0, 10), title: r.title, url: r.url! }));
}

/** Older cached reads may miss newer fields; fill their defaults. */
const normalize = (m: Marketing | null | undefined): Marketing | null => { if (!m) return null; try { return { ...m, ...Result.parse(m) }; } catch { return null; } };

/** The cached read for one carrier site; regenerates when its pages changed (or `force`). */
export async function marketingFor(siteKey: string, opts: { force?: boolean; generate?: boolean } = {}): Promise<Marketing | null> {
  const site = SITES.find((s) => s.key === siteKey);
  if (!site || site.skip) return null;
  const id = `cache:marketing:${siteKey}`;
  const cached = await db.rateFile.findUnique({ where: { id } });
  const c = cached?.stats as { hash?: string; pagesHash?: string; m?: Marketing; failedAt?: string } | null;
  if (opts.generate === false) return normalize(c?.m);
  const pages = await db.productPage.findMany({ where: { site: siteKey }, select: { url: true, title: true, kind: true, text: true, score: true, hash: true, fetchedAt: true } });
  if (!pages.length) return normalize(c?.m);
  const pagesHash = createHash("sha1").update(pages.map((p) => p.hash).sort().join(",") + MODEL()).digest("hex").slice(0, 16);
  const hash = createHash("sha1").update(pagesHash + (await partnerNews(site.match)).map((n) => n.url).join(",")).digest("hex").slice(0, 16);
  // A read the preferred model didn't write (it fell back) is retried once a day.
  const fellBack = !!c?.m && c.m.model !== MODEL() && Date.now() - new Date(c.m.generatedAt).getTime() > 864e5;
  if (!opts.force && c?.hash === hash && c.m && !fellBack) return normalize(c.m);
  // A failed read waits six hours before trying again (no paying for the same failure every few minutes).
  if (!opts.force && c?.failedAt && Date.now() - new Date(c.failedAt).getTime() < 6 * 3600e3) return normalize(c.m);
  // New partnership headlines alone re-read the carrier at most weekly.
  if (!opts.force && !fellBack && c?.m && c.pagesHash === pagesHash && Date.now() - new Date(c.m.generatedAt).getTime() < 7 * 864e5) return normalize(c.m);
  const news = await partnerNews(site.match);
  const r = await claudeJson({ label: `marketing ${siteKey}`, tool: "record_products", schema: SCHEMA, model: MODEL(), maxTokens: 16_000, timeoutMs: 300_000, system: SYSTEM, user: `Carrier: ${site.label}\n\nPAGES:${corpus(pages)}${news.length ? `\n\nNEWS (headlines about partnerships, last two years):\n${news.map((n) => `- ${n.date} ${n.title} <${n.url}>`).join("\n")}` : ""}` });
  const fail = async () => {
    const data = { carrier: "_cache", carrierName: "_cache", network: "marketing", url: "", status: "cache", stats: JSON.parse(JSON.stringify({ ...(c ?? {}), failedAt: new Date().toISOString() })), processedAt: cached?.processedAt ?? null };
    await db.rateFile.upsert({ where: { id }, create: { id, ...data }, update: data }).catch(() => {});
    return normalize(c?.m);
  };
  if (!r) return fail();
  let parsed: z.infer<typeof Result>;
  try { parsed = Result.parse(r.data); } catch (e) { console.error(`[marketing] ${siteKey}: reply didn't fit the schema (${(e as Error).message.slice(0, 300)})`); return fail(); }
  if (!parsed.products.length) { console.error(`[marketing] ${siteKey}: no products in the reply`); return fail(); }
  // Keep only source links that were actually crawled or linked, so a made-up URL can't slip through.
  const known = new Set([...pages.map((p) => p.url), ...news.map((n) => n.url)]);
  const linked = (u: string) => known.has(u) || pages.some((p) => p.text.includes(u));
  const okPartner = (x: ProductPartner) => ({ ...x, source: x.source && known.has(x.source) ? x.source : null });
  parsed.products = parsed.products.map((p) => ({ ...p, sources: p.sources.filter((u) => known.has(u)), docs: p.docs.filter((d) => linked(d.url) || known.has(d.url)), partners: p.partners.map(okPartner) }));
  parsed.partners = parsed.partners.map(okPartner);
  const m: Marketing = {
    ...parsed, site: siteKey, label: site.label, generatedAt: new Date().toISOString(), model: r.model,
    pages: pages.filter((p) => p.kind === "html").length, pdfs: pages.filter((p) => p.kind === "pdf").length,
    crawledAt: pages.reduce<Date | null>((a, p) => (!a || p.fetchedAt > a ? p.fetchedAt : a), null)?.toISOString() ?? null,
  };
  const data = { carrier: "_cache", carrierName: "_cache", network: "marketing", url: "", status: "cache", stats: JSON.parse(JSON.stringify({ hash, pagesHash, m })), processedAt: new Date() };
  await db.rateFile.upsert({ where: { id }, create: { id, ...data }, update: data }).catch(() => {});
  return m;
}

/** Product archetypes a buyer would recognise, derived from the extracted fields. */
export const ARCHETYPES = [
  { key: "virtual", label: "Virtual-first", test: (p: MarketedProduct) => p.virtualFirst },
  { key: "limited", label: "Limited network", test: (p: MarketedProduct) => p.network === "limited" },
  { key: "system", label: "Health-system / ACO", test: (p: MarketedProduct) => p.network === "system-anchored" },
  { key: "tiered", label: "Tiered network", test: (p: MarketedProduct) => p.network === "tiered" },
  { key: "cdhp", label: "HSA / HRA", test: (p: MarketedProduct) => p.costDesign.some((c) => /hsa|hra|consumer/i.test(c)) },
  { key: "copay", label: "Copay-only / no deductible", test: (p: MarketedProduct) => p.costDesign.some((c) => /copay-only|no deductible|copay only/i.test(c)) },
  { key: "value", label: "Value-based benefits", test: (p: MarketedProduct) => p.costDesign.some((c) => /value-based|condition|chronic|reference/i.test(c)) },
  { key: "level", label: "Level-funded", test: (p: MarketedProduct) => p.funding.some((f) => /level/i.test(f)) },
] as const;
