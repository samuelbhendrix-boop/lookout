import { claudeJson } from "../ai";
import { db } from "../db";
import { issuerPatternFor } from "../marketdata/queries";
import { marketingFor, type MarketedProduct } from "../marketing/extract";
import { siteFor, SITES } from "../marketing/sites";

/**
 * Large-group and self-funded launches. Carriers don't file these products with CMS, so there is no complete list;
 * three signals stand in for one:
 *  1. Marketed: a product that appears on a carrier's own pages or brochures for the first time (monthly crawl).
 *  2. Network: a network that appears in a carrier's price-transparency index for the first time (monthly files).
 *     New networks usually mean a new product: a tiered, limited or health-system network, or a new ASO network.
 *  3. Announced: launch announcements in the news feed that mention employers / large group / self-funded.
 * 1 and 2 start from a baseline (everything seen the first time is "already there"), so they build up month by month.
 */

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\b(plan|plans|the|with|and|network)\b/g, " ").replace(/\s+/g, " ").trim();
const isGroup = (p: MarketedProduct) => p.segments.some((s) => /large|self|aso|level|employer|jumbo|national account|municipal/i.test(s));

async function sight(kind: "marketed" | "network", site: string, name: string, detail: object, baseline: boolean) {
  const key = norm(name);
  if (!key) return;
  const now = new Date();
  await db.launchSighting.upsert({
    where: { kind_site_key: { kind, site, key } },
    create: { kind, site, key, name, detail: JSON.parse(JSON.stringify(detail)), baseline, firstSeen: now, lastSeen: now },
    update: { lastSeen: now, name, detail: JSON.parse(JSON.stringify(detail)) },
  });
}

/** Record what is marketed and published now. The very first pass for a source is the baseline. */
export async function recordSightings(): Promise<{ marketed: number; networks: number }> {
  let marketed = 0, networks = 0;
  for (const s of SITES.filter((x) => !x.skip)) {
    const m = await marketingFor(s.key, { generate: false });
    if (!m) continue;
    const baseline = (await db.launchSighting.count({ where: { kind: "marketed", site: s.key } })) === 0;
    for (const p of m.products.filter(isGroup)) {
      await sight("marketed", s.key, p.name, { label: s.label, segments: p.segments, states: p.states, network: p.network, networkDetail: p.networkDetail, virtualFirst: p.virtualFirst, pitch: p.pitch, sources: p.sources.slice(0, 2), partners: p.partners.map((x) => x.name) }, baseline);
      marketed++;
    }
  }
  const files = await db.rateFile.findMany({ where: { status: { in: ["ok", "duplicate"] } }, select: { carrier: true, carrierName: true, network: true, url: true, lastUpdated: true } });
  const byCarrier = new Map<string, typeof files>();
  for (const f of files) (byCarrier.get(f.carrier) ?? byCarrier.set(f.carrier, []).get(f.carrier)!).push(f);
  for (const [carrier, fs] of byCarrier) {
    const baseline = (await db.launchSighting.count({ where: { kind: "network", site: carrier } })) === 0;
    for (const f of fs) { await sight("network", carrier, f.network, { carrierName: f.carrierName, url: f.url, lastUpdated: f.lastUpdated }, baseline); networks++; }
  }
  return { marketed, networks };
}

const NOT = /medicare|medicaid|masshealth|dual|snp\b|part d|dental only|retiree/i;

export type LgLaunch = {
  kind: "marketed" | "network" | "announced";
  when: Date; competitorId: string | null; competitor: string; name: string;
  detail: string | null; network?: string | null; url?: string | null; evidence?: string[];
};

export async function largeGroupLaunches(workspaceId: string): Promise<{ launches: LgLaunch[]; lineup: Array<{ competitorId: string; competitor: string; products: MarketedProduct[] }>; baselineAt: Date | null }> {
  const comps = await db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true, newsScope: true } });
  const bySite = new Map(comps.map((c) => [siteFor(c.name)?.key, c] as const).filter(([k]) => k));
  const byCarrierName = (n: string) => comps.find((c) => { try { return new RegExp(issuerPatternFor(c), "i").test(n); } catch { return false; } }) ?? null;
  const out: LgLaunch[] = [];

  const sightings = await db.launchSighting.findMany({ where: { baseline: false }, orderBy: { firstSeen: "desc" }, take: 500 });
  for (const s of sightings) {
    const d = (s.detail ?? {}) as Record<string, unknown>;
    if (s.kind === "marketed") {
      const c = bySite.get(s.site);
      out.push({ kind: "marketed", when: s.firstSeen, competitorId: c?.id ?? null, competitor: c?.name ?? String(d.label ?? s.site), name: s.name, detail: (d.pitch as string) ?? (d.networkDetail as string) ?? null, network: (d.network as string) ?? null, evidence: (d.sources as string[]) ?? [] });
    } else {
      const c = byCarrierName(String(d.carrierName ?? ""));
      out.push({ kind: "network", when: s.firstSeen, competitorId: c?.id ?? null, competitor: c?.name ?? String(d.carrierName ?? s.site), name: s.name, detail: "New network in the carrier's price-transparency files", url: (d.url as string) ?? null });
    }
  }

  // Announcements: news headlines an AI pass has judged to be commercial product / network launches (classifyLaunchNews).
  const cls = await db.rateFile.findUnique({ where: { id: `cache:lglaunch-news:${workspaceId}` } });
  const judged = ((cls?.stats ?? {}) as { items?: Record<string, Judged> }).items ?? {};
  const ids = Object.entries(judged).filter(([, j]) => j.launch && /group|self|employer|all commercial/i.test(j.segment)).map(([id]) => id);
  if (ids.length) {
    const sigs = await db.signal.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, url: true, publishedAt: true, createdAt: true, competitorId: true } });
    for (const n of sigs) {
      const c = comps.find((x) => x.id === n.competitorId);
      const j = judged[n.id];
      out.push({ kind: "announced", when: n.publishedAt ?? n.createdAt, competitorId: c?.id ?? null, competitor: c?.name ?? "", name: j.product ? `${j.product}: ${n.title}` : n.title, detail: `${j.what}${j.segment ? ` (${j.segment})` : ""}`, url: n.url });
    }
  }
  out.sort((a, b) => b.when.getTime() - a.when.getTime());

  // Today's large-group / self-funded line-up from the carriers' own material (what a launch is measured against).
  const lineup: Array<{ competitorId: string; competitor: string; products: MarketedProduct[] }> = [];
  for (const [key, c] of bySite) {
    const m = key ? await marketingFor(key, { generate: false }) : null;
    const ps = m?.products.filter(isGroup) ?? [];
    if (ps.length) lineup.push({ competitorId: c.id, competitor: c.name, products: ps });
  }
  lineup.sort((a, b) => b.products.length - a.products.length);
  const baselineAt = (await db.launchSighting.aggregate({ where: { baseline: true }, _min: { firstSeen: true } }))._min.firstSeen;
  return { launches: out, lineup, baselineAt };
}

type Judged = { launch: boolean; segment: string; product: string | null; what: string };
const CANDIDATE = /\b(launch|introduc|unveil|roll(s|ed|ing)? out|debut|new (health )?(plan|product|network|offering|option|benefit)|now offer|partner|team(s|ed)? up|collaborat|expand|select(s|ed)? .{0,30} (as|to)|tiered|narrow network|aco\b|virtual[- ]first|level[- ]funded|ichra)/i;

/**
 * Judge new candidate headlines once each: is this a commercial (employer or individual) product or network launch?
 * Cheap model, batched, results cached by signal id. Run daily from the worker.
 */
export async function classifyLaunchNews(workspaceId: string): Promise<number> {
  const id = `cache:lglaunch-news:${workspaceId}`;
  const cached = await db.rateFile.findUnique({ where: { id } });
  const items: Record<string, Judged> = { ...(((cached?.stats ?? {}) as { items?: Record<string, Judged> }).items ?? {}) };
  const since = new Date(Date.now() - 2 * 365 * 864e5);
  const news = await db.signal.findMany({
    where: { workspaceId, competitorId: { not: null }, duplicateOfId: null, OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }] },
    select: { id: true, title: true, summary: true, competitor: { select: { name: true } } }, orderBy: { publishedAt: "desc" }, take: 8000,
  });
  const todo = news.filter((n) => !items[n.id] && CANDIDATE.test(n.title) && !NOT.test(n.title)).slice(0, 200);
  let done = 0;
  for (let i = 0; i < todo.length; i += 40) {
    const batch = todo.slice(i, i + 40);
    const r = await claudeJson({
      label: "launch news", tool: "record_judgements", maxTokens: 4000,
      schema: { type: "object", required: ["items"], properties: { items: { type: "array", items: { type: "object", required: ["n", "launch", "segment", "what"], properties: { n: { type: "integer" }, launch: { type: "boolean" }, segment: { type: "string", enum: ["large group / self-funded", "individual / small group", "all commercial", "not commercial", "unclear"] }, product: { type: ["string", "null"] }, what: { type: "string" } } } } } },
      system: "You screen news headlines about health insurers for a competitive-intelligence team. For each numbered headline decide: is it the insurer launching or announcing a new COMMERCIAL health insurance product, plan design, network (tiered, limited, health-system or ACO-based), or a new partner built into a commercial product? Not: Medicare/Medicaid, corporate deals, sponsorships, community grants, earnings, IT/member portals, prior-authorization programs, unrelated companies with similar names. Give the segment it targets, the product name if stated, and 'what' in under 15 words.",
      user: batch.map((n, k) => `${k + 1}. [${n.competitor?.name}] ${n.title}${n.summary ? ` — ${n.summary.slice(0, 200)}` : ""}`).join("\n"),
    });
    const got = ((r?.data ?? {}) as { items?: Array<{ n: number; launch: boolean; segment: string; product?: string | null; what: string }> }).items ?? [];
    if (!r) break;
    for (const g of got) { const n = batch[g.n - 1]; if (n) { items[n.id] = { launch: !!g.launch, segment: g.segment, product: g.product ?? null, what: g.what }; done++; } }
    // Anything the model skipped counts as judged "no", so it isn't sent again.
    for (const n of batch) items[n.id] ??= { launch: false, segment: "unclear", product: null, what: "" };
  }
  const data = { carrier: "_cache", carrierName: "_cache", network: "lglaunch-news", url: "", status: "cache", stats: JSON.parse(JSON.stringify({ items })), processedAt: new Date() };
  await db.rateFile.upsert({ where: { id }, create: { id, ...data }, update: data });
  return done;
}
