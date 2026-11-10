import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import StreamJson from "stream-json";
import Pick from "stream-json/filters/Pick.js";
import StreamArray from "stream-json/streamers/StreamArray.js";
import type { Prisma } from "@prisma/client";
import { db } from "../db";

/**
 * Transparency in Coverage (TiC) machine-readable files.
 *
 * Federal rule (45 CFR 147.212 / 29 CFR 2590.715-2715A) requires every group health plan, insurer and
 * TPA to post, monthly: in-network negotiated rates, out-of-network allowed amounts, and a table of
 * contents (TOC/index) listing every plan covered — including self-funded employer plans by EIN.
 *
 * What Payersight does with them:
 *  - Reads each carrier's TOC/indexes and keeps the plans whose employer EIN matches a New England
 *    Form 5500 filer (all plans for New England-only carriers). That names the administrator of
 *    self-funded plans, which Form 5500 usually doesn't.
 *  - Records file counts and sizes per carrier (the "examination") on the Transparency page.
 *  - Does NOT bulk-ingest negotiated rates: national carriers publish tens of terabytes monthly.
 *
 * Each carrier publishes differently, so each has a small adapter. Carriers whose files can't be
 * enumerated automatically are listed with their public URL and status "manual".
 */

export type Registry = {
  id: string;
  carrier: string; // canonical name matched by issuer patterns
  url: string; // public landing page / index
  method: string; // human description of how files are published
  adapter?: "cigna" | "uhc" | "harvard_pilgrim" | "toc_json";
  tocUrl?: string;
  regional?: boolean; // New England carrier → keep all plans, not only EIN matches
  note?: string;
};

export const MRF_REGISTRY: Registry[] = [
  { id: "cigna", carrier: "Cigna", adapter: "cigna", url: "https://www.cigna.com/legal/compliance/machine-readable-files", method: "Monthly table-of-contents collection (zip of JSON indexes) via latest.json" },
  { id: "uhc", carrier: "UnitedHealthcare", adapter: "uhc", url: "https://transparency-in-coverage.uhc.com/", method: "Blob listing API: one index per employer plan (~69K), rates per network" },
  { id: "harvard_pilgrim", carrier: "Harvard Pilgrim Health Care", adapter: "harvard_pilgrim", regional: true, url: "https://eusprdtransparencymrfp32.z13.web.core.windows.net/hphc", method: "Plan list page linking one index per employer (ASO) plus HPHC/HPIC/HPHCNE" },
  { id: "mgb", carrier: "Mass General Brigham Health Plan", adapter: "toc_json", regional: true, tocUrl: "https://massgeneralbrighamhealthplan.org/pricetransparency/MRF/Base", url: "https://massgeneralbrighamhealthplan.org/meet-us/transparency-regulations", method: "Single JSON table of contents; rate files 18–78 MB each" },
  { id: "bcbsma", carrier: "Blue Cross and Blue Shield of Massachusetts", regional: true, url: "https://transparency-in-coverage.bluecrossma.com/", method: "Dedicated transparency site: two monthly indexes (YYYY-MM-01_Blue-Cross-and-Blue-Shield-of-Massachusetts[-HMO-Blue]-Inc_index.json)", note: "Its server omits an intermediate TLS certificate; clients must add data/certs/digicert-global-g2-tls-rsa-sha256-2020-ca1.pem. Rate files are reduced monthly in GitHub Actions (rates-snapshots.yml)." },
  { id: "aetna", carrier: "Aetna", url: "https://health1.aetna.com/app/public/#/one/insurerCode=AETNACVS_I&brandCode=ALICSI/machine-readable-transparency-in-coverage", method: "HealthSparq portal (JavaScript app)", note: "Files are behind a JS portal; no stable listing URL." },
  { id: "anthem", carrier: "Elevance Health (Anthem)", url: "https://www.anthem.com/machine-readable-file/search/", method: "Monthly national index (multi-GB gzip) + search page", note: "National index is too large for a small server; search by employer on the page." },
  { id: "tufts", carrier: "Tufts Health Plan", regional: true, url: "https://tuftshealthplan.com/", method: "Point32Health transparency pages", note: "Point32Health moved the Tufts transparency page and the new file location hasn't been found (the Harvard Pilgrim side of Point32 is automated)" },
  { id: "fallon", carrier: "Fallon Community Health Plan", regional: true, url: "https://fallon.sapphiremrfhub.com/", method: "Sapphire MRF hub (JavaScript app)" },
  { id: "cho", carrier: "Maine Community Health Options", regional: true, url: "https://index.opynhealth.com/Community-Health-Options/Community-Health-Options", method: "Opyn Health index" },
  { id: "nhpri", carrier: "Neighborhood Health Plan of Rhode Island", regional: true, url: "https://www.nhpri.org/members/commercial-members-individual-family-plans/price-transparency-machine-readable-files/", method: "Plan web page with file links" },
  { id: "wellsense", carrier: "WellSense Health Plan", regional: true, url: "https://bmchp-wellsense.healthtrioconnect.com/app/index.page", method: "HealthTrio portal (JavaScript app)", note: "The HealthTrio portal sits behind a Cloudflare browser challenge, so no automated client can list files. Download a rate file in a browser and run npm run mrf:reduce on it" },
];

// ─── helpers ─────────────────────────────────────────────────────────

export const normEin = (s: string | undefined | null) => {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length >= 8 && d.length <= 9 ? d.padStart(9, "0") : null;
};

const SUFFIX = /\b(THE|INC|INCORPORATED|LLC|L L C|CORP|CORPORATION|CO|COMPANY|LTD|LP|LLP|PC|PLLC|PA|NA|N A|DBA|USA|US|OF AMERICA)\b/g;
/** Employer-name key for matching UHC file names to Form 5500 sponsors. */
export function nameKey(s: string): string {
  return s.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
}

const UA = { "User-Agent": "Mozilla/5.0 (compatible; PayersightBot/0.5; +https://github.com/samuelbhendrix-boop/lookout)" };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`);
  return (await res.json()) as T;
}

async function downloadTo(url: string, file: string) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
}

type ReportingPlan = { plan_name?: string; plan_id?: string; plan_id_type?: string; plan_market_type?: string; plan_sponsor_name?: string };
type Structure = { reporting_plans?: ReportingPlan[]; in_network_files?: Array<{ location: string }>; allowed_amount_file?: { location: string } };

/** Streams `reporting_structure[]` out of a (possibly huge) TOC JSON without loading it into memory. */
async function eachStructure(input: NodeJS.ReadableStream, onStructure: (s: Structure) => void) {
  const stream = input.pipe(StreamJson.parser()).pipe(Pick.pick({ filter: "reporting_structure" })).pipe(StreamArray.streamArray());
  for await (const { value } of stream as AsyncIterable<{ value: Structure }>) onStructure(value);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── run ─────────────────────────────────────────────────────────────

type Collected = { rows: Prisma.PlanAdministrationCreateManyInput[]; stats: Record<string, number | string> };

export async function importTransparency(): Promise<number> {
  const neEins = new Set((await db.employerPlan.findMany({ select: { ein: true }, distinct: ["ein"] })).map((e) => normEin(e.ein)).filter(Boolean) as string[]);
  const neNames = new Map<string, string>();
  for (const e of await db.employerPlan.findMany({ select: { sponsor: true, ein: true }, distinct: ["ein"] })) {
    const k = nameKey(e.sponsor);
    if (k.length > 4) neNames.set(k, e.ein);
  }
  const dir = await mkdtemp(join(tmpdir(), "lookout-tic-"));
  let total = 0;
  try {
    for (const reg of MRF_REGISTRY) {
      if (!reg.adapter) {
        await db.mrfSource.upsert({ where: { id: reg.id }, create: { id: reg.id, carrier: reg.carrier, status: "manual" }, update: { carrier: reg.carrier, status: "manual" } });
        continue;
      }
      try {
        const out = await ADAPTERS[reg.adapter](reg, { neEins, neNames, dir });
        await db.planAdministration.deleteMany({ where: { carrier: reg.carrier } });
        for (let i = 0; i < out.rows.length; i += 1000) await db.planAdministration.createMany({ data: out.rows.slice(i, i + 1000), skipDuplicates: true });
        total += out.rows.length;
        out.stats.keptPlans = new Set(out.rows.map((r) => `${r.ein}|${r.planName}`)).size;
        out.stats.neEmployersMatched = new Set(out.rows.map((r) => r.ein).filter((e) => neEins.has(e))).size;
        await db.mrfSource.upsert({
          where: { id: reg.id },
          create: { id: reg.id, carrier: reg.carrier, status: "ok", lastRunAt: new Date(), stats: out.stats },
          update: { carrier: reg.carrier, status: "ok", lastRunAt: new Date(), error: null, stats: out.stats },
        });
      } catch (e) {
        await db.mrfSource.upsert({
          where: { id: reg.id },
          create: { id: reg.id, carrier: reg.carrier, status: "failed", lastRunAt: new Date(), error: (e as Error).message.slice(0, 500) },
          update: { carrier: reg.carrier, status: "failed", lastRunAt: new Date(), error: (e as Error).message.slice(0, 500) },
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return total;
}

type Ctx = { neEins: Set<string>; neNames: Map<string, string>; dir: string };

function keep(reg: Registry, entity: { name: string; type?: string; asOf?: string }, plans: ReportingPlan[], tocUrl: string, ctx: Ctx, out: Collected["rows"]) {
  for (const p of plans) {
    if ((p.plan_id_type ?? "").toLowerCase() !== "ein") continue;
    const ein = normEin(p.plan_id);
    if (!ein) continue;
    if (!reg.regional && !ctx.neEins.has(ein)) continue;
    out.push({
      carrier: reg.carrier, reportingEntity: entity.name, entityType: entity.type ?? null, ein,
      sponsorName: p.plan_sponsor_name?.replace(/-/g, " ").trim() || null, planName: (p.plan_name ?? "").replace(/-/g, " ").trim() || "(unnamed plan)",
      marketType: p.plan_market_type ?? null, tocUrl, asOf: entity.asOf && /^\d{4}-\d{2}-\d{2}/.test(entity.asOf) ? new Date(entity.asOf.slice(0, 10)) : null,
    });
  }
}

const ADAPTERS: Record<NonNullable<Registry["adapter"]>, (reg: Registry, ctx: Ctx) => Promise<Collected>> = {
  /** Cigna: latest.json → zip of TOC JSONs (the main one is ~44 MB) → stream each. */
  async cigna(reg, ctx) {
    const latest = await fetchJson<{ mrfs: Array<{ kind: string; files: Array<{ url: string; file_name: string }> }> }>("https://www.cigna.com/static/mrf/latest.json");
    const toc = latest.mrfs.flatMap((m) => (m.kind === "TOC" ? m.files : []))[0];
    if (!toc) throw new Error("No TOC entry in latest.json");
    const zipPath = join(ctx.dir, "cigna.zip");
    await downloadTo(toc.url, zipPath);
    const rows: Collected["rows"] = [];
    let plans = 0, structures = 0, inNetwork = 0, files = 0;
    const zip = await new Promise<yauzl.ZipFile>((res, rej) => yauzl.open(zipPath, { lazyEntries: true }, (e, z) => (e ? rej(e) : res(z!))));
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry: yauzl.Entry) => {
        if (!entry.fileName.endsWith(".json")) return zip.readEntry();
        files++;
        zip.openReadStream(entry, async (err, s) => {
          if (err || !s) return reject(err);
          try {
            const name = entry.fileName.replace(/^.*?_|_index\.json$/g, "").replace(/-/g, " ");
            await eachStructure(s, (st) => {
              structures++;
              plans += st.reporting_plans?.length ?? 0;
              inNetwork += st.in_network_files?.length ?? 0;
              keep(reg, { name, type: "Health Insurance Issuer / TPA" }, st.reporting_plans ?? [], toc.file_name, ctx, rows);
            });
            zip.readEntry();
          } catch (e) {
            reject(e);
          }
        });
      });
      zip.readEntry();
    });
    zip.close();
    return { rows, stats: { tocFiles: files, reportingStructures: structures, reportingPlans: plans, inNetworkFileRefs: inNetwork, reportingMonth: toc.file_name.slice(0, 10) } };
  },

  /** UHC: listing API (one index per employer). Match file names to New England employers, then confirm by EIN. */
  async uhc(reg, ctx) {
    const res = await fetch("https://transparency-in-coverage.uhc.com/api/v1/uhc/blobs/", { headers: UA, signal: AbortSignal.timeout(5 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`UHC listing HTTP ${res.status}`);
    const stream = Readable.fromWeb(res.body as never).pipe(StreamJson.parser()).pipe(Pick.pick({ filter: "blobs" })).pipe(StreamArray.streamArray());
    let indexes = 0, inNetwork = 0, inNetworkBytes = 0, allowed = 0;
    let month = "";
    const candidates: string[] = [];
    for await (const { value } of stream as AsyncIterable<{ value: { name: string; downloadUrl: string; size: number } }>) {
      const n = value.name;
      if (!month && /^\d{4}-\d{2}-\d{2}/.test(n)) month = n.slice(0, 10);
      if (n.endsWith("_index.json")) {
        indexes++;
        const emp = n.replace(/^\d{4}-\d{2}-\d{2}_/, "").replace(/_index\.json$/, "").replace(/-/g, " ");
        if (ctx.neNames.has(nameKey(emp))) candidates.push(value.downloadUrl);
      } else if (n.includes("in-network")) {
        inNetwork++;
        inNetworkBytes += value.size ?? 0;
      } else if (n.includes("allowed-amounts")) allowed++;
    }
    const rows: Collected["rows"] = [];
    for (const url of candidates.slice(0, 3000)) {
      try {
        const toc = await fetchJson<{ reporting_entity_name: string; reporting_entity_type?: string; last_updated_on?: string; reporting_structure: Structure[] }>(url);
        for (const st of toc.reporting_structure ?? [])
          keep(reg, { name: toc.reporting_entity_name.replace(/-/g, " "), type: toc.reporting_entity_type, asOf: toc.last_updated_on }, st.reporting_plans ?? [], url, ctx, rows);
      } catch {
        /* one bad index shouldn't sink the run */
      }
      await sleep(250);
    }
    return { rows, stats: { employerIndexes: indexes, nameMatchedIndexes: candidates.length, inNetworkFiles: inNetwork, inNetworkTB: Math.round(inNetworkBytes / 1e10) / 100, allowedAmountFiles: allowed, reportingMonth: month } };
  },

  /** Harvard Pilgrim: plan-list page → one index per employer. Regional: keep every plan. */
  async harvard_pilgrim(reg, ctx) {
    const res = await fetch(reg.url, { headers: UA, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const urls = [...new Set(html.match(/https:\/\/eusprdtransparencymrfp32\.blob\.core\.windows\.net\/hphc\/[^'"]+_index\.json/g) ?? [])];
    if (!urls.length) throw new Error("No index links found — page layout may have changed");
    const rows: Collected["rows"] = [];
    let plans = 0, inNetwork = 0, ok = 0;
    for (const url of urls) {
      try {
        const toc = await fetchJson<{ reporting_entity_name: string; reporting_entity_type?: string; last_updated_on?: string; reporting_structure: Structure[] }>(url);
        ok++;
        for (const st of toc.reporting_structure ?? []) {
          plans += st.reporting_plans?.length ?? 0;
          inNetwork += st.in_network_files?.length ?? 0;
          keep(reg, { name: toc.reporting_entity_name, type: toc.reporting_entity_type, asOf: toc.last_updated_on }, st.reporting_plans ?? [], url, ctx, rows);
        }
      } catch {
        /* skip */
      }
      await sleep(150);
    }
    return { rows, stats: { employerIndexes: urls.length, indexesRead: ok, reportingPlans: plans, inNetworkFileRefs: inNetwork } };
  },

  /** A single JSON TOC (MGB). Also records rate-file sizes, since regional files are small enough to use. */
  async toc_json(reg, ctx) {
    const toc = await fetchJson<{ reporting_entity_name: string; reporting_entity_type?: string; last_updated_on?: string; reporting_structure: Structure[] }>(reg.tocUrl!);
    const rows: Collected["rows"] = [];
    const inn = new Set<string>();
    let plans = 0;
    for (const st of toc.reporting_structure ?? []) {
      plans += st.reporting_plans?.length ?? 0;
      for (const f of st.in_network_files ?? []) inn.add(f.location);
      keep(reg, { name: toc.reporting_entity_name, type: toc.reporting_entity_type, asOf: toc.last_updated_on }, st.reporting_plans ?? [], reg.tocUrl!, ctx, rows);
    }
    let bytes = 0;
    for (const u of inn) {
      try {
        const h = await fetch(u, { method: "HEAD", headers: UA, signal: AbortSignal.timeout(20_000) });
        bytes += Number(h.headers.get("content-length") ?? 0);
      } catch { /* ignore */ }
    }
    return { rows, stats: { reportingPlans: plans, groupPlans: rows.filter((r) => r.marketType === "group").length, inNetworkFiles: inn.size, inNetworkMB: Math.round(bytes / 1e6), lastUpdated: toc.last_updated_on ?? "" } };
  },
};
