import { db } from "../db";
import { ALLOWED_DATA_HOSTS, DATASETS, type Dataset } from "./datasets";

/**
 * Finds new yearly releases of the public files Payersight imports, so a new plan year or reporting year arrives
 * without a code change. Runs weekly from the worker; cheap (a few page reads and HEAD requests).
 *
 *  - Rate filings (URRT): the year's zip is linked from CMS's rate-review page; its file name changes every release,
 *    so the page is read. A changed link for a year already on file (CMS republishes) replaces it and re-imports.
 *  - Loss ratios (MLR), Form 5500 and Exchange plans (QHP): predictable file names, so next year's file is probed.
 *  - MA CHIA enrollment: databooks are linked from CHIA's enrollment page; the latest "data through" edition per
 *    year wins.
 * Anything found is stored (cache row) and merged into the dataset list; a market event announces it in Updates.
 */

type Entry = { dataset: Dataset; year: number; url: string };
export type Found = Entry & { foundAt: string; note: string };
type State = { checkedAt: string; found: Found[]; problems: string[] };
const ID = "cache:datasets-discovered";
const UA = "Mozilla/5.0 (compatible; PayersightBot; +https://github.com/samuelbhendrix-boop/lookout)";
const PAGES = {
  urrt: "https://www.cms.gov/marketplace/resources/data/rate-review-data",
  chia: "https://www.chiamass.gov/enrollment-in-health-insurance/",
};
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const allowed = (u: string) => { try { return ALLOWED_DATA_HOSTS.has(new URL(u).hostname); } catch { return false; } };

export async function discovered(): Promise<State | null> {
  const row = await db.rateFile.findUnique({ where: { id: ID } });
  return (row?.stats as State | null) ?? null;
}

/** The static list with discovered entries merged in: a discovered entry adds a year or replaces that year's URL. */
export async function allDatasets(): Promise<Array<Entry & { discovered?: boolean }>> {
  const d = await discovered().catch(() => null);
  const out: Array<Entry & { discovered?: boolean }> = DATASETS.map((x) => ({ ...x }));
  for (const f of d?.found ?? []) {
    const i = out.findIndex((x) => x.dataset === f.dataset && x.year === f.year);
    if (i >= 0) out[i] = { dataset: f.dataset, year: f.year, url: f.url, discovered: true };
    else out.push({ dataset: f.dataset, year: f.year, url: f.url, discovered: true });
  }
  return out;
}

async function exists(url: string): Promise<boolean> {
  if (!allowed(url)) return false;
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const res = await fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(30_000), headers: { "user-agent": UA, ...(method === "GET" ? { range: "bytes=0-0" } : {}) } });
      await res.body?.cancel().catch(() => {});
      if (res.ok || res.status === 206) return true;
      if (res.status === 404 || res.status === 410) return false;
    } catch { /* try GET */ }
  }
  return false;
}

async function page(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} reading ${url}`);
  return res.text();
}
const hrefs = (html: string, base: string) => [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => { try { return new URL(m[1].replace(/&amp;/g, "&"), base).toString(); } catch { return ""; } }).filter(Boolean);

/** Plan year from a rate-review file name: the first standalone 4-digit 20xx (so "py2025puf20241024" → 2025). */
export function urrtYear(url: string): number | null {
  const name = url.split("/").pop() ?? "";
  const m = name.match(/(?<!\d)(20\d\d)(?!\d)/);
  return m ? Number(m[1]) : null;
}
/** CHIA databook → its data-through date, e.g. "...-thru-September-2025-Databook.xlsx" → { year: 2025, month: 8 }. */
export function chiaEdition(url: string): { year: number; month: number } | null {
  const m = decodeURIComponent(url).match(/Enrollment-Trends.*?(?:thru|through)-([A-Za-z]+)-(20\d\d)-Databook\.xlsx$/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  return month < 0 ? null : { year: Number(m[2]), month };
}

export async function discoverReleases(): Promise<State> {
  const known = await allDatasets();
  const maxYear = (ds: Dataset) => Math.max(0, ...known.filter((k) => k.dataset === ds).map((k) => k.year));
  const prev = await discovered();
  const found: Found[] = [...(prev?.found ?? [])];
  const problems: string[] = [];
  const now = new Date().toISOString();
  const add = (e: Entry, note: string) => {
    const cur = known.find((k) => k.dataset === e.dataset && k.year === e.year);
    if (cur?.url === e.url) return;
    const i = found.findIndex((f) => f.dataset === e.dataset && f.year === e.year);
    const f = { ...e, foundAt: now, note };
    if (i >= 0) found[i] = f; else found.push(f);
  };

  // Rate filings: read CMS's page; plan years we have or newer.
  try {
    const links = hrefs(await page(PAGES.urrt), PAGES.urrt).filter((u) => /\.zip$/i.test(u) && allowed(u));
    const minYear = Math.min(...DATASETS.filter((d) => d.dataset === "urrt").map((d) => d.year));
    for (const u of links) {
      const y = urrtYear(u);
      if (y && y >= minYear) add({ dataset: "urrt", year: y, url: u }, known.some((k) => k.dataset === "urrt" && k.year === y) ? "CMS republished the file" : "new plan year");
    }
  } catch (e) { problems.push(`Rate filings page: ${(e as Error).message}`); }

  // Loss ratios and Form 5500: next year's file at the usual address.
  for (const [ds, url] of [
    ["mlr", (y: number) => `https://www.cms.gov/files/zip/mlr-public-use-file-${y}.zip`],
    ["dol_5500", (y: number) => `https://askebsa.dol.gov/FOIA%20Files/${y}/Latest/F_5500_${y}_Latest.zip`],
  ] as const) {
    const y = maxYear(ds) + 1;
    try { if (await exists(url(y))) add({ dataset: ds, year: y, url: url(y) }, "new reporting year"); } catch (e) { problems.push(`${ds} ${y}: ${(e as Error).message}`); }
  }

  // Exchange plans: next plan year if either the federal or a state-exchange file is up.
  {
    const y = maxYear("qhp") + 1;
    const probes = [`https://download.cms.gov/marketplace-puf/${y}/plan-attributes-puf.zip`, `https://www.cms.gov/files/zip/massachusettssbepuf${y}.zip`];
    try { for (const p of probes) if (await exists(p)) { add({ dataset: "qhp", year: y, url: "registry:lib/marketdata/qhp.ts" }, "new plan year"); break; } } catch (e) { problems.push(`qhp ${y}: ${(e as Error).message}`); }
  }

  // CHIA: the latest databook per data-through year, for years we have or newer.
  try {
    const eds = hrefs(await page(PAGES.chia), PAGES.chia).filter(allowed).map((u) => ({ u, e: chiaEdition(u) })).filter((x): x is { u: string; e: { year: number; month: number } } => !!x.e);
    const top = Math.max(...known.filter((k) => k.dataset === "ma_chia").map((k) => k.year));
    const byYear = new Map<number, { u: string; month: number }>();
    for (const { u, e } of eds) if (e.year >= top && (byYear.get(e.year)?.month ?? -1) < e.month) byYear.set(e.year, { u, month: e.month });
    for (const [y, x] of byYear) add({ dataset: "ma_chia", year: y, url: x.u }, `databook through ${MONTHS[x.month]} ${y}`);
  } catch (e) { problems.push(`CHIA page: ${(e as Error).message}`); }

  const state: State = { checkedAt: now, found, problems };
  const data = { carrier: "_cache", carrierName: "_cache", network: "datasets-discovered", url: "", status: "cache", stats: JSON.parse(JSON.stringify(state)), processedAt: new Date() };
  await db.rateFile.upsert({ where: { id: ID }, create: { id: ID, ...data }, update: data });

  // Announce what's new since the last check (idempotent per dataset, year and URL).
  const LABEL: Record<string, string> = { urrt: "ACA rate filings (CMS)", mlr: "Loss-ratio filings (CMS)", dol_5500: "Form 5500 filings (DOL)", qhp: "Exchange plan files (CMS)", ma_chia: "MA enrollment databook (CHIA)" };
  for (const f of found.filter((f) => f.foundAt === now)) {
    await db.marketEvent.upsert({
      where: { eventKey: `data_release:${f.dataset}:${f.year}:${f.url}` },
      create: { eventKey: `data_release:${f.dataset}:${f.year}:${f.url}`, kind: "data_release", carrier: "Public data", title: `New data: ${LABEL[f.dataset] ?? f.dataset} ${f.year}`, summary: `${LABEL[f.dataset] ?? f.dataset}, ${f.year} (${f.note}). Found automatically and queued for import; see Settings → System status.`, url: "/settings", importance: 3, occurredAt: new Date() },
      update: {},
    }).catch(() => {});
  }
  return state;
}

/** Weekly, from the worker. */
export async function maybeDiscover(): Promise<string | null> {
  const d = await discovered().catch(() => null);
  if (d && Date.now() - new Date(d.checkedAt).getTime() < 7 * 864e5) return null;
  const s = await discoverReleases();
  const fresh = s.found.filter((f) => f.foundAt === s.checkedAt);
  return `release check: ${fresh.length ? fresh.map((f) => `${f.dataset} ${f.year}`).join(", ") : "nothing new"}${s.problems.length ? `; problems: ${s.problems.join("; ")}` : ""}`;
}
