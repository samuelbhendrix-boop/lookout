import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { claudeJson } from "./ai";
import { decode, facts } from "./explore";
import { issuerPatternFor } from "./marketdata/queries";
import { marketingFor } from "./marketing/extract";
import { siteFor } from "./marketing/sites";

/**
 * A competitor's commercial product strategy, written by AI from everything the site holds on them: what they market
 * (their own website), what they filed (plans, rates, state filings), how their book is moving (members, premium, loss
 * ratio, employer accounts) and recent moves. The evidence is assembled here as plain text; the read may only use it.
 * Cached per competitor and rewritten when the evidence changes (at most weekly) or on request.
 */
const MODEL = () => process.env.MARKETING_MODEL ?? "claude-sonnet-5-5";
const VERSION = "1";

const Read = z.object({
  headline: z.string(),
  summary: z.string(),
  whereTheyPlay: z.array(z.string()).catch([]),
  productStrategy: z.array(z.string()).catch([]),
  pricing: z.string().nullish(),
  distribution: z.string().nullish(),
  partners: z.string().nullish(),
  momentum: z.string().nullish(),
  recentMoves: z.array(z.string()).catch([]),
  versusUs: z.array(z.string()).catch([]),
  watch: z.array(z.string()).catch([]),
  confidence: z.enum(["high", "medium", "low"]).catch("low"),
  basis: z.string().nullish(),
});
export type Strategy = z.infer<typeof Read> & { generatedAt: string; model: string; sources: string[] };

const str = { type: "string" } as const, list = { type: "array", items: { type: "string" } } as const;
const SCHEMA = {
  type: "object",
  properties: {
    headline: { ...str, description: "The strategy in one sentence, 25 words or fewer." },
    summary: { ...str, description: "Three to five sentences: what they are trying to do in commercial insurance and how." },
    whereTheyPlay: { ...list, description: "2-4 bullets: the segments and states they concentrate on, with member counts, rank or share and the year." },
    productStrategy: { ...list, description: "3-6 bullets: how the portfolio is built (network models, plan types, virtual-first, HSA or level-funded options, standard vs differentiated designs) and what they lead with." },
    pricing: { ...str, description: "Pricing posture in 1-3 sentences: filed rate changes, premium level against the other carriers listed, loss ratio. Null if the evidence has no pricing data." },
    distribution: { ...str, description: "How they sell (brokers, exchange, direct, municipal or association programs), 1-2 sentences. Null if not shown." },
    partners: { ...str, description: "Named vendors, health systems and partners that matter to the strategy, 1-2 sentences. Null if none are named." },
    momentum: { ...str, description: "Whether the commercial book is growing or shrinking, with the numbers and years. Null if there is no trend data." },
    recentMoves: { ...list, description: "Up to 6 dated, concrete moves from the last year or so (filings, launches, rate actions, account wins or losses, reworded marketing)." },
    versusUs: { ...list, description: "Up to 4 bullets on what this means for OUR CARRIER, using the comparison numbers given. Empty if no 'our carrier' section is given." },
    watch: { ...list, description: "Up to 4 things to watch next, each tied to something in the evidence." },
    confidence: { type: "string", enum: ["high", "medium", "low"], description: "high: marketing, filings and financials all present and consistent; medium: one of them thin; low: mostly one source." },
    basis: { ...str, description: "One sentence on what the read rests on and what is missing." },
  },
  required: ["headline", "summary", "whereTheyPlay", "productStrategy", "recentMoves", "versusUs", "watch", "confidence", "basis"],
};
const SYSTEM = `You are a competitive-intelligence analyst at a New England health insurer, writing for the product team. From the EVIDENCE below, work out one competitor's COMMERCIAL product strategy (employer group, small business, individual and family; not Medicare or Medicaid).

Rules:
- Use only the evidence. Never add outside knowledge about the company. If the evidence doesn't show something, say it isn't shown or leave the field null or empty.
- Keep what the carrier SAYS (its marketing) apart from what the NUMBERS and FILINGS show, and say so when they disagree.
- Quote numbers exactly as given, with their year and state. Don't compute new statistics beyond simple differences between two given figures.
- Fully insured members come from loss-ratio filings and lag by a year or more; filed plans cover individual and small group only; large group product detail comes only from the carrier's website. Don't treat a missing source as evidence of absence.
- Plain, specific sentences. No filler, no hedging boilerplate, no recommendations beyond the "versusUs" and "watch" fields.`;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown) => (num(v) == null ? "n/a" : Math.round(num(v)!).toLocaleString("en-US"));
const usd = (a: unknown, b: unknown, mult = 1) => (num(a) != null && num(b) ? `$${Math.round((num(a)! / num(b)!) * mult).toLocaleString("en-US")}` : "n/a");
const pct = (a: unknown, b: unknown) => (num(a) != null && num(b) ? `${((num(a)! / num(b)!) * 100).toFixed(1)}%` : "n/a");
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "undated");
type Comp = { id: string; name: string; aliases: string[]; issuerPattern: string | null };

/** The evidence for one competitor as plain text, plus the list of sources that had something. */
export async function strategyEvidence(workspaceId: string, comp: Comp, comps: Comp[], usName: string | null): Promise<{ text: string; sources: string[]; marketingAt: string | null }> {
  const out: string[] = [], sources: string[] = [];
  const section = (title: string, source: string, lines: string[]) => { if (lines.length) { out.push(`\n## ${title}\n${lines.join("\n")}`); sources.push(source); } };
  let re: RegExp; try { re = new RegExp(issuerPatternFor(comp), "i"); } catch { re = new RegExp(comp.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }

  // 1. What they market, from their own website.
  const site = siteFor(comp.name);
  const m = site && !site.skip ? await marketingFor(site.key, { generate: false }).catch(() => null) : null;
  if (m) {
    section("WHAT THEY SAY: marketing on their own website", "Carrier website", [
      `Read from ${m.pages} pages and ${m.pdfs} documents, crawled ${m.crawledAt?.slice(0, 10) ?? "n/a"}.`,
      `Summary: ${m.summary}`, ...(m.structure ? [`Portfolio structure: ${m.structure}`] : []), ...(m.positioning.length ? [`Positioning: ${m.positioning.join(" | ")}`] : []), ...(m.channels ? [`Channels: ${m.channels}`] : []),
      ...(m.partners.length ? [`Partners named: ${m.partners.slice(0, 25).map((p) => `${p.name}${p.role ? ` (${p.role})` : ""}`).join("; ")}`] : []),
      "Products:",
      ...m.products.slice(0, 40).map((p) => `- ${p.name} [${p.segments.join(", ") || "segment n/a"}; ${p.states.join(", ") || "states n/a"}; ${p.planType ?? "type n/a"}; network ${p.network}${p.virtualFirst ? "; virtual-first" : ""}; funding ${p.funding.join(", ") || "n/a"}]${p.targetBuyer ? ` aimed at ${p.targetBuyer}.` : ""}${p.pitch ? ` Pitch: ${p.pitch}` : ""}${p.costDesign.length ? ` Cost design: ${p.costDesign.slice(0, 4).join("; ")}.` : ""}`.slice(0, 700)),
      ...(m.gaps ? [`Not clear from the site: ${m.gaps}`] : []),
    ]);
  }

  // 2–4. The numbers: members, premium and loss ratio; filed plans; employer accounts.
  const [ovF, plF] = await Promise.all([facts("overview", workspaceId, comps), facts("plans", workspaceId, comps)]);
  const ov = decode(ovF).filter((o) => o.period === "Each year");
  const mine = ov.filter((o) => o.carrier === comp.name);
  const key = (o: Record<string, string | number | null>) => `${o.state}|${o.segment}|${o.year}`;
  const fin = mine.filter((o) => num(o.lives) != null).sort((a, b) => String(a.state).localeCompare(String(b.state)) || String(a.segment).localeCompare(String(b.segment)) || Number(a.year) - Number(b.year));
  const finLines = fin.filter((o) => Number(o.year) >= Math.max(...fin.map((x) => Number(x.year))) - 4).map((o) => {
    const peers = ov.filter((x) => key(x) === key(o) && num(x.lives) != null).sort((a, b) => num(b.lives)! - num(a.lives)!);
    const total = peers.reduce((a, x) => a + num(x.lives)!, 0);
    return `- ${o.state} ${o.segment} ${o.year}: ${int(o.lives)} members (rank ${peers.findIndex((x) => x.carrier === comp.name) + 1} of ${peers.length}, ${pct(o.lives, total)} of listed carriers), premium ${usd(o.premium, o.mm)} PMPM, loss ratio ${pct(o.claims, o.premium)}`;
  });
  section("WHAT THE NUMBERS SHOW: fully insured members, premium and loss ratio (CMS loss-ratio filings)", "Loss-ratio filings", finLines);
  const sf = decode(ovF).filter((o) => o.period === "Latest available" && o.carrier === comp.name && num(o.sf) != null).map((o) => `- ${o.state} ${o.segment}: ${int(o.sf)} self-funded members, ${int(o.fi)} fully insured (state enrollment report, latest)`);
  section("Self-funded and fully insured members (state enrollment reports, MA and NH only)", "State enrollment reports", sf);

  const plans = decode(plF).filter((o) => o.carrier === comp.name && o.term !== 1);
  if (plans.length) {
    const g = new Map<string, typeof plans>();
    for (const p of plans) { const k = `${p.state} ${p.segment} ${p.year}`; (g.get(k) ?? g.set(k, []).get(k)!).push(p); }
    const lastYear = Math.max(...plans.map((p) => Number(p.year)));
    const lines = [...g].filter(([, ps]) => Number(ps[0].year) >= lastYear - 2).sort((a, b) => a[0].localeCompare(b[0])).map(([k, ps]) => {
      const w = ps.filter((p) => num(p.rate) != null), ws = w.reduce((a, p) => a + (num(p.members) || 1), 0);
      const rate = w.length ? `${((w.reduce((a, p) => a + num(p.rate)! * (num(p.members) || 1), 0) / ws) * 100).toFixed(1)}%` : "n/a";
      const p40 = ps.filter((p) => num(p.prem40) != null);
      const mem = ps.some((p) => num(p.members) != null) ? int(ps.reduce((a, p) => a + (num(p.members) ?? 0), 0)) : "n/a";
      return `- ${k}: ${ps.length} plans (${ps.filter((p) => p.isNew === 1).length} new), ${mem} members, average premium at age 40 ${p40.length ? `$${Math.round(p40.reduce((a, p) => a + num(p.prem40)!, 0) / p40.length)}` : "n/a"}, filed rate change ${rate}`;
    });
    // Design detail comes from the exchange files, which can trail the rate filings by a year: use the newest year that has it.
    const designYears = plans.filter((p) => p.hsa != null).map((p) => Number(p.year));
    const designYear = designYears.length ? Math.max(...designYears) : null;
    const latest = plans.filter((p) => Number(p.year) === designYear && p.hsa != null);
    const mix = (k: string) => { const c = new Map<string, number>(); for (const p of latest) if (p[k] != null) c.set(String(p[k]), (c.get(String(p[k])) ?? 0) + 1); return [...c].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} ${n}`).join(", ") || "n/a"; };
    const yes = (k: string) => latest.filter((p) => p[k] === "Yes").length;
    if (latest.length) lines.push(`Design mix of the ${latest.length} plans in the ${designYear} exchange files: metal ${mix("metal")}; network type ${mix("ntype")}; networks ${mix("nname").slice(0, 300)}; HSA-eligible ${yes("hsa")}; tiered network ${yes("tiered")}; standardized design ${yes("std")}; referral needed ${yes("referral")}.`);
    section("WHAT THEY FILED: individual and small group plans (rate filings and exchange files; large group is not filed)", "Plan and rate filings", lines);
  }
  const emp = mine.filter((o) => (num(o.emps) ?? 0) >= 5).sort((a, b) => String(a.state).localeCompare(String(b.state)) || Number(a.year) - Number(b.year));
  section("Large group employer accounts (Form 5500; mostly employers with 100+ participants; newest year incomplete)", "Form 5500",
    emp.filter((o) => Number(o.year) >= Math.max(...emp.map((x) => Number(x.year))) - 3).map((o) => `- ${o.state} ${o.year}: ${int(o.emps)} employer accounts, ${int(o.empPersons)} covered persons, premium ${num(o.empPrem) ? usd(o.empPrem, o.empPersons, 1 / 12) : "n/a"} per person per month`));

  // 5–8. State filings, detected changes, reworded marketing, news.
  const yearAgo = new Date(Date.now() - 400 * 864e5);
  const [filings, events, reworded, signals] = await Promise.all([
    db.serffFiling.findMany({ orderBy: { submitted: "desc" }, select: { tracking: true, state: true, company: true, market: true, planYear: true, disposition: true, detail: true } }),
    db.marketEvent.findMany({ where: { occurredAt: { gte: yearAgo } }, orderBy: [{ importance: "desc" }, { occurredAt: "desc" }], take: 3000, select: { kind: true, carrier: true, state: true, title: true, occurredAt: true } }),
    site ? db.productPageVersion.findMany({ where: { site: site.key, replacedAt: { gte: new Date(Date.now() - 120 * 864e5) } }, orderBy: { replacedAt: "desc" }, take: 12, select: { title: true, replacedAt: true, added: true } }) : Promise.resolve([]),
    db.signal.findMany({ where: { workspaceId, competitorId: comp.id, duplicateOfId: null, status: { not: "ARCHIVED" }, publishedAt: { gte: new Date(Date.now() - 180 * 864e5) } }, orderBy: [{ importance: "desc" }, { publishedAt: "desc" }], take: 20, select: { title: true, publishedAt: true, type: true } }),
  ]);
  section("State filings loaded from SERFF (only what was uploaded)", "State filings", filings.filter((f) => re.test(f.company ?? "")).slice(0, 8).map((f) => {
    const d = (f.detail ?? {}) as { headline?: string; points?: string[] };
    return `- ${f.state ?? ""} ${f.market ?? ""} ${f.planYear ?? ""} (${f.disposition ?? "status n/a"}): ${d.headline ?? "no summary"}${d.points?.length ? ` Points: ${d.points.slice(0, 3).join(" ")}` : ""}`.slice(0, 900);
  }));
  section("Changes detected in the last year (rate filings, negotiated-rate and network changes, accounts won and lost)", "Detected market changes", events.filter((e) => re.test(e.carrier) || e.carrier === comp.name).slice(0, 18).map((e) => `- ${day(e.occurredAt)} ${e.kind.replace(/_/g, " ")}${e.state ? ` (${e.state})` : ""}: ${e.title}`));
  section("Marketing wording they changed in the last four months", "Website changes", reworded.flatMap((v) => (Array.isArray(v.added) ? v.added : []).filter((x): x is string => typeof x === "string").slice(0, 3).map((l) => `- ${day(v.replacedAt)} on "${v.title}": added "${l.slice(0, 300)}"`)).slice(0, 15));
  section("News headlines about them, last six months (headlines only; some are not about commercial insurance, and the date is when the story was picked up)", "News", signals.map((s) => `- ${day(s.publishedAt)}: ${s.title}`));

  // Our own carrier, for the comparison.
  if (usName && usName !== comp.name) {
    const keys = new Set(fin.map((o) => `${o.state}|${o.segment}`));
    const us = ov.filter((o) => o.carrier === usName && num(o.lives) != null && keys.has(`${o.state}|${o.segment}`));
    const lastBy = new Map<string, (typeof us)[number]>();
    for (const o of us) { const k = `${o.state}|${o.segment}`; if (!lastBy.has(k) || Number(o.year) > Number(lastBy.get(k)!.year)) lastBy.set(k, o); }
    if (lastBy.size) out.push(`\n## OUR CARRIER (${usName}) in the same states and segments, latest year\n${[...lastBy.values()].map((o) => `- ${o.state} ${o.segment} ${o.year}: ${int(o.lives)} members, premium ${usd(o.premium, o.mm)} PMPM, loss ratio ${pct(o.claims, o.premium)}`).join("\n")}`);
  }
  return { text: out.join("\n").slice(0, 60_000), sources, marketingAt: m?.generatedAt ?? null };
}

const idFor = (competitorId: string) => `cache:strategy:${competitorId}`;
type Cached = { hash?: string; s?: Strategy; failedAt?: string; thin?: boolean };
/** A read needs at least one of these; news and a few employer filings alone say nothing about product strategy. */
const CORE = ["Carrier website", "Loss-ratio filings", "Plan and rate filings"];
const parse = (s: Strategy | undefined): Strategy | null => { if (!s) return null; const r = Read.safeParse(s); return r.success ? { ...s, ...r.data } : null; };

/** The stored reads for a workspace's competitors, without generating anything. */
export async function storedStrategies(competitorIds: string[]): Promise<Map<string, Strategy | "thin">> {
  const rows = await db.rateFile.findMany({ where: { id: { in: competitorIds.map(idFor) } }, select: { id: true, stats: true } });
  const out = new Map<string, Strategy | "thin">();
  for (const r of rows) { const c = r.stats as Cached | null, s = parse(c?.s); if (s) out.set(r.id.slice("cache:strategy:".length), s); else if (c?.thin) out.set(r.id.slice("cache:strategy:".length), "thin"); }
  return out;
}

/** Write (or rewrite) one competitor's strategy read. Returns null when there is no AI key, no evidence, or the read failed. */
export async function strategyFor(workspaceId: string, competitorId: string, opts: { force?: boolean } = {}): Promise<Strategy | null> {
  const [comps, ws, cached] = await Promise.all([
    db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } }),
    db.workspace.findUnique({ where: { id: workspaceId }, select: { ownCompetitorId: true } }),
    db.rateFile.findUnique({ where: { id: idFor(competitorId) }, select: { stats: true } }),
  ]);
  const comp = comps.find((c) => c.id === competitorId);
  if (!comp) return null;
  const c = (cached?.stats ?? null) as Cached | null;
  const prev = parse(c?.s);
  const usName = comps.find((x) => x.id === ws?.ownCompetitorId)?.name ?? null;
  const ev = await strategyEvidence(workspaceId, comp, comps, usName);
  const save = (stats: Cached) => { const data = { carrier: "_cache", carrierName: "_cache", network: "strategy", url: "", status: "cache", stats: JSON.parse(JSON.stringify(stats)), processedAt: new Date() }; return db.rateFile.upsert({ where: { id: idFor(competitorId) }, create: { id: idFor(competitorId), ...data }, update: data }); };
  if (!ev.sources.some((x) => CORE.includes(x))) { if (!prev && !c?.thin) await save({ thin: true }); return prev; }
  const hash = createHash("sha1").update(VERSION + MODEL() + ev.text).digest("hex").slice(0, 16);
  if (!opts.force) {
    if (prev && c?.hash === hash) return prev;
    // Evidence shifts a little daily (news), so rewrite weekly at most, unless their website has been re-read since.
    const freshMarketing = !!ev.marketingAt && !!prev && ev.marketingAt > prev.generatedAt;
    if (prev && !freshMarketing && Date.now() - new Date(prev.generatedAt).getTime() < 7 * 864e5) return prev;
    if (c?.failedAt && Date.now() - new Date(c.failedAt).getTime() < 6 * 3600e3) return prev;
  }
  const ask = () => claudeJson({ label: `strategy ${comp.name}`, tool: "record_strategy", schema: SCHEMA, model: MODEL(), maxTokens: 6000, timeoutMs: 180_000, system: SYSTEM, user: `${usName === comp.name ? "CARRIER (this is our own carrier; leave versusUs empty)" : "COMPETITOR"}: ${comp.name}\n\nEVIDENCE${ev.text}` }).catch(() => null);
  let r = await ask(), read = r ? Read.safeParse(r.data) : null;
  // One retry: a busy API or a cut-off reply is usually fine the second time.
  if (!r || !read?.success) { await new Promise((res) => setTimeout(res, 5000)); r = await ask(); read = r ? Read.safeParse(r.data) : null; }
  if (!r || !read?.success) { if (process.env.ANTHROPIC_API_KEY) await save({ ...c, failedAt: new Date().toISOString() }); return prev; }
  const s: Strategy = { ...read.data, versusUs: usName && usName !== comp.name ? read.data.versusUs : [], generatedAt: new Date().toISOString(), model: r.model, sources: ev.sources };
  await save({ hash, s });
  return s;
}

let busy = false, lastRun = 0;
/** Background: write any missing strategy reads and refresh stale ones. Checked every six hours; one carrier at a time. */
export async function maybeRefreshStrategies(log: (m: string) => void): Promise<void> {
  if (busy || !process.env.ANTHROPIC_API_KEY || Date.now() - lastRun < 6 * 3600e3) return;
  busy = true; lastRun = Date.now();
  try {
    for (const w of await db.workspace.findMany({ select: { id: true, ownCompetitorId: true } })) {
      const comps = await db.competitor.findMany({ where: { workspaceId: w.id }, select: { id: true, name: true } }); // our own carrier too, for head-to-head
      const before = await storedStrategies(comps.map((c) => c.id));
      for (const c of comps) {
        const s = await strategyFor(w.id, c.id).catch((e) => { log(`[strategy] ${c.name} failed: ${(e as Error).message}`); return null; });
        const was = before.get(c.id);
        if (s && s.generatedAt !== (was && was !== "thin" ? was.generatedAt : undefined)) log(`[strategy] wrote ${c.name} (${s.confidence} confidence)`);
      }
    }
  } finally { busy = false; }
}

const writing = new Map<string, number>();
/** Start a rewrite in the background (the read takes about a minute, too long to hold a page request open). */
export function startStrategy(workspaceId: string, competitorId: string): void {
  if (Date.now() - (writing.get(competitorId) ?? 0) < 4 * 60_000) return;
  writing.set(competitorId, Date.now());
  void strategyFor(workspaceId, competitorId, { force: true }).catch((e) => console.error(`[strategy] rewrite failed: ${(e as Error).message}`)).finally(() => writing.delete(competitorId));
}
export const isWriting = (competitorId: string) => Date.now() - (writing.get(competitorId) ?? 0) < 4 * 60_000;

export type H2HRow = { state: string; segment: string; a: { lives: number | null; pmpm: number | null; lr: number | null }; b: { lives: number | null; pmpm: number | null; lr: number | null } };
/** Two carriers' latest fully insured members, premium and loss ratio, side by side, wherever either has 1,000+ members. */
export async function headToHead(workspaceId: string, aName: string, bName: string): Promise<H2HRow[]> {
  const comps = await db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } });
  const ov = decode(await facts("overview", workspaceId, comps)).filter((o) => o.period === "Latest available" && num(o.lives) != null);
  const cell = (o?: Record<string, string | number | null>) => ({ lives: num(o?.lives), pmpm: o && num(o.premium) != null && num(o.mm) ? num(o.premium)! / num(o.mm)! : null, lr: o && num(o.claims) != null && num(o.premium) ? num(o.claims)! / num(o.premium)! : null });
  const keys = [...new Set(ov.filter((o) => o.carrier === aName || o.carrier === bName).map((o) => `${o.state}|${o.segment}`))].sort();
  return keys.map((k) => { const [state, segment] = k.split("|"); const f = (n: string) => ov.find((o) => o.carrier === n && o.state === state && o.segment === segment); return { state, segment, a: cell(f(aName)), b: cell(f(bName)) }; })
    .filter((r) => Math.max(r.a.lives ?? 0, r.b.lives ?? 0) >= 1000);
}
