import type { SourceKind } from "@prisma/client";
import { db } from "./db";

const gnews = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

/**
 * The best regular coverage of health insurers, New England health policy and regulators, checked to load from the
 * server (Nov 2026). Outlets that block automated readers (Fierce Healthcare, Modern Healthcare, Boston Business
 * Journal, Axios, Health Affairs, NH Insurance Dept: HTTP 403 or JavaScript-only) are covered through Google News
 * queries limited to their site instead. Broad feeds are fine: items about none of your competitors and no market
 * topic are filed away automatically.
 */
export const RECOMMENDED_SOURCES: Array<{ name: string; url: string; kind: SourceKind; group: "Industry" | "New England" | "Regulators"; why: string }> = [
  // Payer industry trade press.
  { group: "Industry", name: "Becker's Payer Issues", kind: "RSS", url: "https://www.beckerspayer.com/feed/", why: "Fastest daily coverage of insurer leadership, contracts, membership and earnings." },
  { group: "Industry", name: "Fierce Healthcare (payers)", kind: "RSS", url: gnews("site:fiercehealthcare.com (insurer OR payer OR \"health plan\" OR Medicare Advantage)"), why: "Deep payer reporting; its own feed blocks bots, so read via Google News." },
  { group: "Industry", name: "STAT", kind: "RSS", url: "https://www.statnews.com/feed/", why: "Boston-based; strong on insurers, PBMs, Medicare Advantage and drug pricing." },
  { group: "Industry", name: "Modern Healthcare (insurance)", kind: "RSS", url: gnews("site:modernhealthcare.com (insurer OR insurers OR payer OR \"health plan\")"), why: "Industry paper of record; site is JavaScript-only, so via Google News." },
  { group: "Industry", name: "Managed Healthcare Executive", kind: "RSS", url: "https://www.managedhealthcareexecutive.com/rss", why: "Health plan operations, pharmacy benefits, value-based contracts." },
  { group: "Industry", name: "Axios Vitals (insurers)", kind: "RSS", url: gnews("site:axios.com (insurer OR insurers OR UnitedHealth OR Elevance OR Cigna OR Aetna OR Centene)"), why: "Quick scoops on insurer strategy and earnings." },
  { group: "Industry", name: "Georgetown CHIR blog", kind: "RSS", url: "https://chirblog.org/feed/", why: "Best analysis of ACA marketplace rules and state insurance regulation." },
  { group: "Industry", name: "AHIP press releases", kind: "WEBPAGE", url: "https://www.ahip.org/news/press-releases", why: "The insurer trade association's positions on federal policy." },
  { group: "Industry", name: "Insurer earnings & deals", kind: "RSS", url: gnews("(UnitedHealth OR Elevance OR Cigna OR Aetna OR CVS OR Centene OR Humana) (earnings OR \"medical cost\" OR \"medical loss ratio\" OR acquisition)"), why: "Quarterly results and M&A of the national carriers." },
  // New England newsrooms.
  { group: "New England", name: "CommonWealth Beacon (health care)", kind: "RSS", url: "https://commonwealthbeacon.org/category/health-care/feed/", why: "Best Massachusetts health-policy reporting: HPC, Connector, cost trends, hospital-insurer fights." },
  { group: "New England", name: "Boston Globe (health care business)", kind: "WEBPAGE", url: "https://www.bostonglobe.com/business/healthcare/", why: "MGB, Point32, BCBSMA and hospital-system news." },
  { group: "New England", name: "WBUR (health insurance)", kind: "RSS", url: gnews("site:wbur.org (\"health insurance\" OR insurer OR \"health plan\" OR \"Health Connector\")"), why: "Boston public radio's health desk." },
  { group: "New England", name: "Boston Business Journal (health care)", kind: "RSS", url: gnews("site:bizjournals.com/boston (\"health plan\" OR insurer OR \"Blue Cross\" OR Point32Health OR \"Mass General Brigham\")"), why: "Executive moves and employer-market news; blocks bots, so via Google News." },
  { group: "New England", name: "Health Care For All (MA)", kind: "RSS", url: "https://hcfama.org/feed/", why: "Consumer-advocate view on MA coverage, affordability and the Connector." },
  { group: "New England", name: "CT Mirror", kind: "RSS", url: "https://ctmirror.org/feed/", why: "Connecticut's main policy newsroom: Access Health CT, rate reviews, ConnectiCare." },
  { group: "New England", name: "New Hampshire Bulletin (health)", kind: "RSS", url: "https://newhampshirebulletin.com/category/health/feed/", why: "NH Medicaid, exchange and insurance department coverage." },
  { group: "New England", name: "Rhode Island Current (health care)", kind: "RSS", url: "https://rhodeislandcurrent.com/category/health-care/feed/", why: "OHIC rate reviews, BCBSRI and NHPRI." },
  { group: "New England", name: "VTDigger (health)", kind: "RSS", url: "https://vtdigger.org/category/health/feed/", why: "Green Mountain Care Board rate decisions, BCBSVT and MVP." },
  { group: "New England", name: "Maine Morning Star", kind: "RSS", url: "https://mainemorningstar.com/feed/", why: "Maine policy newsroom: CoverME, Anthem and Community Health Options." },
  // Regulators (their own pages).
  { group: "Regulators", name: "MA Division of Insurance news", kind: "WEBPAGE", url: "https://www.mass.gov/orgs/division-of-insurance/news", why: "Rate decisions, hearings and bulletins, straight from the regulator." },
  { group: "Regulators", name: "RI OHIC press releases", kind: "WEBPAGE", url: "https://ohic.ri.gov/press-releases", why: "Rhode Island rate approvals and affordability standards." },
  { group: "Regulators", name: "VT DFR news", kind: "WEBPAGE", url: "https://dfr.vermont.gov/news", why: "Vermont insurance regulator notices." },
];

const APPLIED_ID = (ws: string) => `cache:recommended-sources:${ws}`;
/** Bump when the list changes; each workspace gets newly listed sources once, so ones you delete stay deleted. */
export const RECOMMENDED_VERSION = 1;

/** Adds recommended sources this workspace hasn't been offered yet (by URL). Returns how many were added. */
export async function applyRecommendedSources(workspaceId: string, only?: string[]): Promise<number> {
  const existing = new Set((await db.source.findMany({ where: { workspaceId }, select: { url: true } })).map((s) => s.url));
  const add = RECOMMENDED_SOURCES.filter((s) => !existing.has(s.url) && (!only || only.includes(s.url)));
  if (add.length) await db.source.createMany({ data: add.map((s) => ({ workspaceId, name: s.name, kind: s.kind, url: s.url, pollMinutes: s.kind === "WEBPAGE" ? 360 : 60 })) });
  return add.length;
}

/** Worker: once per list version, add the recommended sources to every workspace. */
export async function ensureRecommendedSources(): Promise<string[]> {
  const out: string[] = [];
  for (const w of await db.workspace.findMany({ select: { id: true, name: true } })) {
    const id = APPLIED_ID(w.id);
    const row = await db.rateFile.findUnique({ where: { id }, select: { stats: true } });
    const applied = ((row?.stats as { version?: number; urls?: string[] } | null) ?? {});
    if ((applied.version ?? 0) >= RECOMMENDED_VERSION) continue;
    const offered = new Set(applied.urls ?? []);
    const n = await applyRecommendedSources(w.id, RECOMMENDED_SOURCES.map((s) => s.url).filter((u) => !offered.has(u)));
    const data = { carrier: "_cache", carrierName: "_cache", network: "recommended-sources", url: "", status: "cache", stats: { version: RECOMMENDED_VERSION, urls: RECOMMENDED_SOURCES.map((s) => s.url) }, processedAt: new Date() };
    await db.rateFile.upsert({ where: { id }, create: { id, ...data }, update: data });
    if (n) out.push(`added ${n} recommended sources to ${w.name}`);
  }
  return out;
}
