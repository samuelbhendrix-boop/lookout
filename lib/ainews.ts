import Parser from "rss-parser";
import { createHash } from "node:crypto";
import { claudeJson } from "./ai";
import { db } from "./db";
import { fetchFeed, linkOf, stripHtml, textOf } from "./ingest";

/**
 * AI watch: developments in the AI industry that bear on health insurance — payers' own use of AI, AI in prior
 * authorization and claims (and the lawsuits and rules around it), regulation, provider-side AI that changes what
 * payers see, vendors and deals, and frontier labs' health moves. News searches every few hours; a cheap model judges
 * each new story once (relevant? category, impact, why it matters); a stronger model writes the weekly read.
 */
const q = (s: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(`${s} when:14d`)}&hl=en-US&gl=US&ceid=US:en`;
export const AI_FEEDS: Array<{ key: string; url: string }> = [
  { key: "payers", url: q('("health insurer" OR "health plan" OR payer) ("artificial intelligence" OR "generative AI" OR "AI agent" OR "AI tool")') },
  { key: "prior-auth", url: q('("prior authorization" OR "utilization management" OR "claims denial" OR "claim denials") (AI OR algorithm OR "artificial intelligence")') },
  { key: "big-payers", url: q('(UnitedHealth OR Optum OR Elevance OR Cigna OR Evernorth OR Aetna OR CVS Health OR Humana OR Centene OR "Blue Cross") ("artificial intelligence" OR "AI")') },
  { key: "regulation", url: q('(CMS OR HHS OR NAIC OR FDA OR "state law" OR legislature OR "attorney general") ("artificial intelligence" OR AI) (insurance OR insurer OR "health plan" OR "Medicare Advantage" OR healthcare)') },
  { key: "frontier", url: q('(OpenAI OR Anthropic OR Google OR Microsoft OR Amazon OR Nvidia OR Epic) (healthcare OR "health care" OR clinical OR medical) AI launch') },
  { key: "providers", url: q('(hospital OR "health system" OR physicians) AI ("revenue cycle" OR coding OR "ambient" OR "denials" OR "documentation")') },
  { key: "vendors", url: q('("health insurance" OR payer OR "health plan") AI startup (raises OR funding OR acquires OR acquisition OR partnership)') },
  { key: "new-england", url: q('("Point32Health" OR "Harvard Pilgrim" OR "Tufts Health" OR "Blue Cross Blue Shield of Massachusetts" OR "Mass General Brigham" OR "Massachusetts" OR "Connecticut") ("artificial intelligence" OR "generative AI") (health OR insurance)') },
];

export const AI_CATEGORIES = ["Payers using AI", "Prior auth & claims", "Regulation & policy", "Providers & care delivery", "Vendors & deals", "Frontier labs & platforms"] as const;

const parser = new Parser();
const keyOf = (t: string) => t.toLowerCase().replace(/\s+[-–|]\s+[^-–|]{2,60}$/, "").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 180);
const outletOf = (t: string) => /\s+-\s+([^-]{2,60})$/.exec(t)?.[1]?.trim() ?? null;
let last = 0;

/** Collect new stories and judge them. Runs at most every 3 hours. */
export async function maybeRefreshAiNews(log: (m: string) => void = () => {}, force = false): Promise<void> {
  if (!force && Date.now() - last < 3 * 3600e3) return;
  last = Date.now();
  let added = 0;
  for (const f of AI_FEEDS) {
    try {
      const feed = await parser.parseString(await fetchFeed(f.url));
      for (const item of feed.items.slice(0, 60)) {
        const raw = stripHtml(textOf(item.title));
        const url = linkOf(item, f.url);
        if (!raw || !url) continue;
        const publishedAt = item.isoDate ? new Date(item.isoDate) : null;
        if (publishedAt && Date.now() - publishedAt.getTime() > 30 * 864e5) continue;
        const titleKey = keyOf(raw);
        if (await db.aiNews.findFirst({ where: { OR: [{ url }, { titleKey }] }, select: { id: true } })) continue;
        await db.aiNews.create({ data: { url, titleKey, title: raw.replace(/\s+-\s+[^-]{2,60}$/, ""), outlet: outletOf(raw), summary: stripHtml(textOf(item.contentSnippet ?? item.content)).slice(0, 800) || null, publishedAt, feed: f.key } }).then(() => added++).catch(() => {});
      }
    } catch (e) { log(`[ai watch] ${f.key}: ${(e as Error).message}`); }
  }
  const judged = await judgeAiNews();
  await db.aiNews.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 365 * 864e5) } } });
  if (added || judged) log(`[ai watch] ${added} new stories, ${judged} judged`);
}

type J = { n: number; relevant: boolean; category: string; impact: number; why: string; companies: string[]; story?: string };
async function judgeAiNews(): Promise<number> {
  const todo = await db.aiNews.findMany({ where: { judged: false }, orderBy: { publishedAt: "desc" }, take: 240 });
  let done = 0;
  const recent = async () => [...new Set((await db.aiNews.findMany({ where: { relevant: true, story: { not: null }, createdAt: { gte: new Date(Date.now() - 10 * 864e5) } }, select: { story: true }, orderBy: { createdAt: "desc" }, take: 150 })).map((x) => x.story!))];
  for (let i = 0; i < todo.length; i += 30) {
    const known = await recent();
    const batch = todo.slice(i, i + 30);
    const r = await claudeJson({
      label: "ai watch", tool: "record_judgements", maxTokens: 6000,
      schema: { type: "object", required: ["items"], properties: { items: { type: "array", items: { type: "object", required: ["n", "relevant", "category", "impact", "why", "companies", "story"], properties: {
        n: { type: "integer" }, relevant: { type: "boolean" }, category: { type: "string", enum: [...AI_CATEGORIES] },
        impact: { type: "integer", enum: [1, 2, 3], description: "3 = changes a US health insurer's costs, operations, compliance or competition now or soon; 2 = notable development to know; 1 = background" },
        why: { type: "string", description: "why a health insurer should care, under 20 words, specific; empty if not relevant" },
        story: { type: "string", description: "3-7 word label for the underlying event, worded the same way for every headline about that event (e.g. 'Google launches Gemini for Healthcare')" },
        companies: { type: "array", items: { type: "string" }, description: "insurers, providers, vendors or labs named" },
      } } } } },
      system: "You screen news for a US regional health insurer's strategy team tracking the AI industry. A story is relevant when it is about AI (machine learning, generative AI, agents, algorithms) AND it bears on health insurance: insurers' or PBMs' use of AI; AI in prior authorization, utilization management, claims, coding, payment integrity, or appeals (and lawsuits or rules about it); regulation of AI in insurance or healthcare; provider or vendor AI that shifts costs, coding intensity or denials between providers and payers; AI products from frontier labs or big tech aimed at healthcare or insurers; funding, M&A and partnerships of AI companies selling to payers. Not relevant: AI with no health or insurance angle, stock tips, general hype, opinion pieces with no news, life/auto/P&C insurance only, duplicates of the same wire story. Judge from the headline and snippet; don't invent details.",
      user: (known.length ? `Story labels already in use (reuse one exactly when a headline is about the same event):\n${known.map((x) => `- ${x}`).join("\n")}\n\nHeadlines:\n` : "") + batch.map((n, k) => `${k + 1}. ${n.title}${n.outlet ? ` (${n.outlet})` : ""}${n.summary ? ` — ${n.summary.slice(0, 300)}` : ""}`).join("\n"),
    });
    if (!r) break;
    const got = ((r.data ?? {}) as { items?: J[] }).items ?? [];
    for (const g of got) {
      const n = batch[g.n - 1];
      if (!n) continue;
      await db.aiNews.update({ where: { id: n.id }, data: { judged: true, relevant: !!g.relevant, category: g.relevant ? g.category : null, impact: g.relevant ? Math.min(3, Math.max(1, g.impact)) : null, why: g.relevant ? g.why || null : null, story: g.story?.trim() || null, companies: (g.companies ?? []).slice(0, 8) } });
      done++;
    }
    // Anything the model skipped counts as judged "not relevant", so it isn't sent again.
    await db.aiNews.updateMany({ where: { id: { in: batch.map((x) => x.id) }, judged: false }, data: { judged: true } });
  }
  return done;
}

export type AiBrief = { points: Array<{ text: string; ids: string[] }>; generatedAt: string; model: string } | null;

/** The week's read: what the most important stories mean for a regional New England insurer. Cached until the top stories change (at most twice a day). */
export async function aiBrief(items: Array<{ id: string; title: string; why: string | null; category: string | null; impact: number | null; publishedAt: Date | null; outlet: string | null }>): Promise<AiBrief> {
  const top = items.filter((i) => (i.impact ?? 0) >= 2).slice(0, 25);
  if (top.length < 3) return null;
  const hash = createHash("sha1").update(top.map((i) => i.id).join(",")).digest("hex").slice(0, 16);
  const id = "cache:ai-brief";
  const cached = await db.rateFile.findUnique({ where: { id } });
  const c = cached?.stats as { hash?: string; brief?: AiBrief } | null;
  if (c?.brief && (c.hash === hash || Date.now() - new Date(c.brief.generatedAt).getTime() < 12 * 3600e3)) return c.brief;
  const r = await claudeJson({
    label: "ai brief", tool: "record_brief", maxTokens: 3000, model: process.env.MARKETING_MODEL ?? "claude-sonnet-5-5",
    schema: { type: "object", required: ["points"], properties: { points: { type: "array", items: { type: "object", required: ["text", "ids"], properties: { text: { type: "string" }, ids: { type: "array", items: { type: "string" } } } } } } },
    system: "You brief the strategy lead at a regional New England health insurer (commercial, Medicare Advantage and Medicaid) on the AI industry. From the stories given, write 3-5 pithy bullets on what matters most and what it means for a regional insurer: threats, moves competitors are making, rules coming, opportunities. Each bullet: one or two sentences, lead with the implication, then the fact it rests on; only facts in the stories; no hype. Cite the story ids each bullet rests on.",
    user: top.map((i) => `id: ${i.id}\ndate: ${i.publishedAt?.toISOString().slice(0, 10) ?? "?"}\ncategory: ${i.category}\nimpact: ${i.impact}\nheadline: ${i.title}${i.outlet ? ` (${i.outlet})` : ""}\nwhy: ${i.why ?? ""}`).join("\n\n"),
  });
  const pts = ((r?.data ?? {}) as { points?: Array<{ text: string; ids: string[] }> }).points;
  if (!r || !pts?.length) return c?.brief ?? null;
  const valid = new Set(top.map((i) => i.id));
  const brief: AiBrief = { points: pts.filter((p) => p.text).map((p) => ({ text: p.text, ids: (p.ids ?? []).filter((x) => valid.has(x)) })).slice(0, 5), generatedAt: new Date().toISOString(), model: r.model };
  const data = { carrier: "_cache", carrierName: "_cache", network: "ai-brief", url: "", status: "cache", stats: JSON.parse(JSON.stringify({ hash, brief })), processedAt: new Date() };
  await db.rateFile.upsert({ where: { id }, create: { id, ...data }, update: data });
  return brief;
}
