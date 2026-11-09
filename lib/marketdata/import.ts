import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { parse } from "csv-parse";
import type { Prisma, Segment } from "@prisma/client";
import { db } from "../db";
import { ALLOWED_DATA_HOSTS, DATASETS, REFRESH_DAYS, type Dataset } from "./datasets";
import { importChia, importStateSnapshots } from "./state";
import { importDol } from "./dol";
import { importTransparency } from "./tic";
import { importRates, ResumeLater } from "./mrf/files";

// ─── helpers (exported for tests) ────────────────────────────────────

export const num = (v: string | undefined): number | null => {
  if (v == null || v.trim() === "") return null;
  const n = Number(v.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** "01/01/2026" → Date (UTC midnight). */
export function usDate(v: string): Date {
  const [m, d, y] = v.split("/").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** URRT plan names arrive with stray CSV escaping: "\"HMO Blue \\"Premier\\" Plan\"" → HMO Blue "Premier" Plan */
export const cleanName = (s: string) => s.replace(/\\"/g, '"').replace(/^"+|"+$/g, "").trim();

// ─── download + unzip (streaming) ────────────────────────────────────

export async function download(url: string, dir: string, name = "data.zip"): Promise<string> {
  const u = new URL(url);
  if (!ALLOWED_DATA_HOSTS.has(u.hostname)) throw new Error(`Refusing to download from ${u.hostname}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000), headers: { "User-Agent": "LookoutBot/0.4" } });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  const file = join(dir, name);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
  return file;
}

/** Streams each CSV entry whose name matches `pick` through `onRow`, one entry at a time. */
export async function eachCsv(
  zipPath: string,
  pick: (name: string) => boolean,
  onRow: (entry: string, row: Record<string, string>) => Promise<void> | void,
  headerCase: "upper" | "lower",
) {
  const zip = await new Promise<yauzl.ZipFile>((res, rej) =>
    yauzl.open(zipPath, { lazyEntries: true }, (e, z) => (e ? rej(e) : res(z!))),
  );
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (entry: yauzl.Entry) => {
      const name = entry.fileName.split("/").pop() ?? "";
      if (!name.toLowerCase().endsWith(".csv") || !pick(name)) return zip.readEntry();
      zip.openReadStream(entry, async (err, stream) => {
        if (err || !stream) return reject(err);
        try {
          // CMS changes header casing between years (MLR 2022 is UPPERCASE, 2024 lowercase) — normalize.
          const columns = (h: string[]) => h.map((c) => (headerCase === "upper" ? c.trim().toUpperCase() : c.trim().toLowerCase()));
          const parser = stream.pipe(parse({ columns, encoding: "latin1", relax_quotes: true, relax_column_count: true, bom: true, skip_empty_lines: true }));
          for await (const row of parser) await onRow(name, row as Record<string, string>);
          zip.readEntry();
        } catch (e) {
          reject(e);
        }
      });
    });
    zip.readEntry();
  });
  zip.close();
}

// ─── URRT (rate filings + plans) ─────────────────────────────────────

async function importUrrt(year: number, zipPath: string): Promise<number> {
  // Wipe this plan year first so re-imports never double count.
  await db.ratePlan.deleteMany({ where: { planYear: year } });
  await db.rateFiling.deleteMany({ where: { planYear: year } });

  const filings: Prisma.RateFilingCreateManyInput[] = [];
  await eachCsv(zipPath, (n) => /WKSH1/i.test(n), (_, r) => {
    if (!r.SUB_TRK_NUM || !r.STATE) return;
    filings.push({
      id: r.SUB_TRK_NUM,
      planYear: year,
      serffNumber: r.SERFF_TRK_NUM || null,
      primaryReviewer: r.PRIM_RVW || null,
      state: r.STATE,
      hiosId: r.ISSUER_ID,
      company: r.COMPANY,
      market: r.MARKET,
      effectiveDate: usDate(r.EFF_DT),
      expPremium: num(r.EXP_PRM),
      expClaims: num(r.EXP_CLM),
      expMemberMonths: num(r.EXP_MM_WK1),
      projMemberMonths: num(r.PRJ_MM_WK1),
      projIndexRate: num(r.TOT_PRJ_MKT_ADJ_IDX_RT ?? r.PRJ_IDX_RT),
    });
  }, "upper");
  for (let i = 0; i < filings.length; i += 1000)
    await db.rateFiling.createMany({ data: filings.slice(i, i + 1000), skipDuplicates: true });
  const filingIds = new Set(filings.map((f) => f.id));

  let batch: Prisma.RatePlanCreateManyInput[] = [];
  let count = 0;
  const flush = async () => {
    if (!batch.length) return;
    await db.ratePlan.createMany({ data: batch, skipDuplicates: true });
    count += batch.length;
    batch = [];
  };
  await eachCsv(zipPath, (n) => /WKSH2/i.test(n), async (_, r) => {
    if (!r.PLAN_ID || !filingIds.has(r.SUB_TRK_NUM)) return;
    batch.push({
      filingId: r.SUB_TRK_NUM,
      planYear: year,
      state: r.STATE,
      hiosId: r.ISSUER_ID,
      company: r.COMPANY,
      market: r.MARKET,
      productId: r.PROD_ID,
      productName: cleanName(r.PROD_NAME ?? ""),
      planId: r.PLAN_ID,
      planName: cleanName(r.PLAN_NAME ?? ""),
      metal: r.METAL || null,
      planType: r.PLAN_TYPE || null,
      onExchange: r.EXCHANGE === "Yes",
      category: r.PLAN_CAT || "Unknown",
      effectiveDate: usDate(r.EFF_DT_PLAN || r.EFF_DT),
      rateChange: num(r.RT_CHG_CUM),
      enrollment: num(r.CUR_ENR) === null ? null : Math.round(num(r.CUR_ENR)!),
      ratePmpm: num(r.CUR_RATE_PMPM),
      expLossRatio: num(r.EXP_LOSS_RATIO),
      projPremiumPmpm: num(r.PRJ_TP_PMPM),
      determination: r.DETERMINATION || null,
    });
    if (batch.length >= 1000) await flush();
  }, "upper");
  await flush();
  return filings.length + count;
}

// ─── MLR (annual financials by segment) ──────────────────────────────

const MLR_CODES: Record<string, keyof Metrics> = {
  TOTAL_DIRECT_PREMIUM_EARNED: "premium",
  TOTAL_INCURRED_CLAIMS_PT1: "claims",
  NUMBER_OF_COVERED_LIVES: "coveredLives",
  MEMBER_MONTHS: "memberMonths",
  AGNTS_AND_BROKERS_FEES_COMMS: "brokerFees",
};
type Metrics = { premium: number; claims: number; coveredLives: number; memberMonths: number; brokerFees: number };
const SEGMENT_COLS: Array<[Segment, string]> = [
  ["INDIVIDUAL", "cmm_individual_yearly"],
  ["SMALL_GROUP", "cmm_small_group_yearly"],
  ["LARGE_GROUP", "cmm_large_group_yearly"],
];

async function importMlr(year: number, zipPath: string): Promise<number> {
  type Header = { state: string; hiosId: string | null; company: string; naicCode: string | null; groupName: string | null };
  const headers = new Map<string, Header>();
  await eachCsv(zipPath, (n) => /Template_Header/i.test(n), (_, r) => {
    const state = (r.business_state ?? "").trim();
    if (!/^[A-Z]{2}$/.test(state)) return; // skip "Grand Total" roll-ups
    headers.set(r.mr_submission_template_id, {
      state,
      hiosId: r.hios_issuer_id || null,
      company: (r.company_name ?? "").trim(),
      naicCode: r.naic_company_code || null,
      groupName: r.group_affiliation || null,
    });
  }, "lower");

  const metrics = new Map<string, Metrics>(); // key: templateId|segment
  await eachCsv(zipPath, (n) => /Part1_2/i.test(n), (_, r) => {
    const field = MLR_CODES[r.row_lookup_code];
    if (!field || !headers.has(r.mr_submission_template_id)) return;
    for (const [seg, col] of SEGMENT_COLS) {
      const v = num(r[col]);
      if (!v) continue;
      const key = `${r.mr_submission_template_id}|${seg}`;
      const m = metrics.get(key) ?? { premium: 0, claims: 0, coveredLives: 0, memberMonths: 0, brokerFees: 0 };
      m[field] += v;
      metrics.set(key, m);
    }
  }, "lower");

  // Same company can file more than one template per state; sum them.
  const rows = new Map<string, Prisma.MarketFinancialCreateManyInput>();
  for (const [key, m] of metrics) {
    const [tid, seg] = key.split("|") as [string, Segment];
    const h = headers.get(tid)!;
    if (m.premium <= 0 && m.coveredLives <= 0) continue;
    const k = `${h.state}|${h.company}|${seg}`;
    const prev = rows.get(k);
    rows.set(k, {
      year, state: h.state, hiosId: h.hiosId, company: h.company, naicCode: h.naicCode, groupName: h.groupName, segment: seg,
      premium: (prev?.premium ?? 0) + m.premium,
      claims: (prev?.claims ?? 0) + m.claims,
      coveredLives: (prev?.coveredLives ?? 0) + m.coveredLives,
      memberMonths: (prev?.memberMonths ?? 0) + m.memberMonths,
      brokerFees: (prev?.brokerFees ?? 0) + m.brokerFees,
    });
  }
  const data = [...rows.values()];
  await db.marketFinancial.deleteMany({ where: { year } });
  for (let i = 0; i < data.length; i += 1000) await db.marketFinancial.createMany({ data: data.slice(i, i + 1000) });
  return data.length;
}

// ─── orchestration ───────────────────────────────────────────────────

export async function importDataset(dataset: Dataset, year: number) {
  const def = DATASETS.find((d) => d.dataset === dataset && d.year === year);
  if (!def) throw new Error(`Unknown dataset ${dataset} ${year}`);
  await db.dataImport.upsert({
    where: { dataset_year: { dataset, year } },
    create: { dataset, year, url: def.url, status: "running" },
    update: { url: def.url, status: "running", error: null, startedAt: new Date(), finishedAt: null },
  });
  const dir = await mkdtemp(join(tmpdir(), "lookout-"));
  try {
    let rows: number;
    if (dataset === "state_snapshots") rows = await importStateSnapshots();
    else if (dataset === "ma_chia") rows = await importChia(await download(def.url, dir, "chia.xlsx"));
    else if (dataset === "dol_5500") rows = await importDol(year, def.url, dir);
    else if (dataset === "tic") rows = await importTransparency();
    else if (dataset === "rates") rows = await importRates(year);
    else {
      const zip = await download(def.url, dir);
      rows = dataset === "urrt" ? await importUrrt(year, zip) : await importMlr(year, zip);
    }
    // A real file always has thousands of rows; zero means CMS changed the layout — fail loudly.
    if (rows === 0) throw new Error("File parsed but produced 0 rows — CMS may have changed the file layout");
    // Change detection on the new data (accounts won/lost, filing rate changes); fanned out to workspaces by the worker.
    if (dataset === "dol_5500" || dataset === "urrt") {
      const { detectAll } = await import("./events");
      await detectAll([dataset === "dol_5500" ? "accounts" : "filings"]);
    }
    await db.dataImport.update({
      where: { dataset_year: { dataset, year } },
      data: { status: "done", rows, finishedAt: new Date() },
    });
    return rows;
  } catch (e) {
    if (e instanceof ResumeLater) {
      // Stopped at the memory budget; due again on the next scheduler tick, continuing from the saved cursor.
      await db.dataImport.update({ where: { dataset_year: { dataset, year } }, data: { status: "partial", rows: e.rows, error: e.message, finishedAt: new Date() } });
      return e.rows;
    }
    await db.dataImport.update({
      where: { dataset_year: { dataset, year } },
      data: { status: "failed", error: (e as Error).message.slice(0, 500), finishedAt: new Date() },
    });
    throw e;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Enqueues at most one due import (never two at once — the files are large and the web
 * instance is small). Called every scheduler tick; cheap when nothing is due.
 */
export async function scheduleNextImport(enqueue: (payload: { dataset: Dataset; year: number }) => Promise<unknown>) {
  if (process.env.MARKET_DATA === "off") return null;
  const busy = await db.dataImport.count({ where: { status: { in: ["queued", "running"] }, startedAt: { gt: new Date(Date.now() - 60 * 60_000) } } });
  if (busy) return null;
  const [next] = await dueImports();
  if (!next) return null;
  await db.dataImport.upsert({
    where: { dataset_year: { dataset: next.dataset, year: next.year } },
    create: { dataset: next.dataset, year: next.year, url: next.url, status: "queued" },
    update: { status: "queued", startedAt: new Date(), error: null },
  });
  await enqueue({ dataset: next.dataset, year: next.year });
  return next;
}

/** Datasets never imported, failed, or older than REFRESH_DAYS. Queued/running ones are skipped unless stuck >1h. */
export async function dueImports() {
  const existing = await db.dataImport.findMany();
  const cutoff = Date.now() - REFRESH_DAYS * 864e5;
  return DATASETS.filter((d) => {
    const e = existing.find((x) => x.dataset === d.dataset && x.year === d.year);
    if (!e) return true;
    if (e.status === "running" || e.status === "queued") return Date.now() - e.startedAt.getTime() > 60 * 60_000; // stuck >1h
    if (e.status === "failed") return Date.now() - (e.finishedAt?.getTime() ?? 0) > 6 * 3600e3;
    if (e.status === "partial") return true; // resume right away in a fresh process
    return (e.finishedAt?.getTime() ?? 0) < cutoff;
  });
}
