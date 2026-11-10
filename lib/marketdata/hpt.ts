import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parse } from "csv-parse";
import yauzl from "yauzl";
import StreamArray from "stream-json/streamers/StreamArray";
import Pick from "stream-json/filters/Pick";
import Parser from "stream-json/Parser";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { manualFiles } from "./manual";
import { benchCodeMap, codeKey } from "./mrf/codes";
import { HOSPITALS } from "./networks";
import tinMap from "../../data/medicare/hospital-tins.json";

/**
 * Hospital price transparency files (45 CFR 180.50). Every hospital publishes, at <domain>/cms-hpt.txt, the URL of a
 * machine-readable file with its negotiated rate for every payer and plan. These fill what carriers' own rate files
 * don't give us — BCBSMA's PPO networks, WellSense — and split each carrier's rates by product (HMO vs PPO).
 * Only the benchmark basket is kept, facility charges only, commercial plans only.
 */

const UA = { "User-Agent": "Mozilla/5.0 (compatible; PayersightBot; +https://github.com/samuelbhendrix-boop/lookout)" };
const MAX_BYTES = 2e9;

/** Hospital (system) websites to read cms-hpt.txt from. A system's file usually lists all of its hospitals. */
export const HPT_DOMAINS: Array<{ domain: string; state: string }> = [
  // Massachusetts
  { domain: "www.bmc.org", state: "MA" }, { domain: "www.mountauburnhospital.org", state: "MA" }, { domain: "www.lowellgeneral.org", state: "MA" },
  { domain: "www.tuftsmedicine.org", state: "MA" }, { domain: "www.melrosewakefield.org", state: "MA" }, { domain: "www.challiance.org", state: "MA" },
  { domain: "www.southcoast.org", state: "MA" }, { domain: "www.ummhealth.org", state: "MA" }, { domain: "www.bidmc.org", state: "MA" },
  { domain: "www.nebh.org", state: "MA" }, { domain: "www.winchesterhospital.org", state: "MA" }, { domain: "www.lahey.org", state: "MA" },
  { domain: "www.beverlyhospital.org", state: "MA" }, { domain: "www.ajh.org", state: "MA" }, { domain: "www.bidplymouth.org", state: "MA" },
  { domain: "www.bidneedham.org", state: "MA" }, { domain: "www.bidmilton.org", state: "MA" }, { domain: "www.massgeneralbrigham.org", state: "MA" },
  { domain: "www.baystatehealth.org", state: "MA" }, { domain: "www.heywood.org", state: "MA" }, { domain: "www.emersonhealth.org", state: "MA" },
  { domain: "www.signature-healthcare.org", state: "MA" }, { domain: "www.sturdymemorial.org", state: "MA" }, { domain: "www.berkshirehealthsystems.org", state: "MA" },
  { domain: "www.merrimackhealth.org", state: "MA" }, { domain: "www.childrenshospital.org", state: "MA" }, { domain: "www.dana-farber.org", state: "MA" },
  { domain: "www.stvincenthospital.com", state: "MA" }, { domain: "www.mwmc.com", state: "MA" }, { domain: "www.holyokehealth.com", state: "MA" },
  { domain: "www.capecodhealth.org", state: "MA" }, { domain: "www.harringtonhospital.org", state: "MA" },
  // New Hampshire
  { domain: "www.dartmouth-health.org", state: "NH" }, { domain: "www.catholicmedicalcenter.org", state: "NH" }, { domain: "www.elliothospital.org", state: "NH" },
  { domain: "www.concordhospital.org", state: "NH" }, { domain: "www.exeterhospital.com", state: "NH" },
  // Maine
  { domain: "www.mainehealth.org", state: "ME" }, { domain: "www.northernlighthealth.org", state: "ME" }, { domain: "www.mainegeneral.org", state: "ME" },
  { domain: "www.cmhc.org", state: "ME" },
  // Rhode Island
  { domain: "www.brownhealth.org", state: "RI" }, { domain: "www.kentri.org", state: "RI" }, { domain: "www.chartercare.org", state: "RI" },
  // Connecticut
  { domain: "www.ynhhs.org", state: "CT" }, { domain: "www.trinityhealthofne.org", state: "CT" },
  { domain: "www.nuvancehealth.org", state: "CT" },
  // Vermont
  { domain: "www.uvmhealth.org", state: "VT" }, { domain: "www.rrmc.org", state: "VT" },
];

/** Not commercial medical coverage: dropped. */
const NON_COMMERCIAL = /public plans|together|rite ?care|medicare|medicaid|masshealth|mass health|\bmco\b|\baco\b|tricare|champva|veteran|\bva\b|workers|work comp|\bauto\b|\bmva\b|dental|vision|behavioral|catch.?all|self.?pay|uninsured|charity|government|dual|senior|advantage|\bsco\b|one care|pace\b|health safety net|hsn|crisis|connectorcare|cobra/i;

const MEDICAID_HEAVY = new Set(["WellSense Health Plan", "Fallon Health", "Neighborhood Health Plan of Rhode Island", "Mass General Brigham Health Plan"]);
const COMMERCIAL_HINT = /commercial|clarity|connector|exchange|\bqhp\b|direct|employer|group|self.?insured|\bgic\b|\bppo\b|\bpos\b|\bepo\b|select|navigator|community care|complete hmo/i;

/** Payer + plan text → canonical carrier. State decides which Blue. */
export function carrierOf(payer: string, plan: string, state: string | null): string | null {
  const t = `${payer} ${plan}`;
  if (/wellsense|bmc ?health ?net|boston medical center health ?plan/i.test(t)) return "WellSense Health Plan";
  if (/\bri neighborhood|neighborhood health plan of r/i.test(t)) return "Neighborhood Health Plan of Rhode Island";
  if (/mass general brigham|allways|\bneighborhood health plan\b/i.test(t)) return "Mass General Brigham Health Plan";
  if (/harvard pilgrim|\bhphc\b|health plans inc/i.test(t)) return "Harvard Pilgrim Health Care";
  if (/tufts health|\btufts hp\b|\bthp\b|tufts.*(hmo|ppo|pos|spirit|direct)/i.test(t)) return "Tufts Health Plan";
  if (/fallon/i.test(t)) return "Fallon Health";
  if (/health new england|\bhne\b/i.test(t)) return "Health New England";
  if (/unicare|wellpoint/i.test(t)) return "UniCare (Elevance)";
  if (/anthem/i.test(t)) return "Anthem Blue Cross and Blue Shield";
  if (/blue cross|\bbcbs|blue shield|\bblue\b/i.test(t)) {
    return state === "MA" ? "Blue Cross Blue Shield of Massachusetts" : state === "RI" ? "Blue Cross & Blue Shield of Rhode Island" : state === "VT" ? "Blue Cross and Blue Shield of Vermont" : "Anthem Blue Cross and Blue Shield";
  }
  if (/aetna/i.test(t)) return "Aetna";
  if (/cigna/i.test(t)) return "Cigna";
  if (/united ?health|\buhc\b|\bumr\b|oxford|optum/i.test(t)) return "UnitedHealthcare";
  if (/community health options/i.test(t)) return "Community Health Options";
  if (/connecticare/i.test(t)) return "ConnectiCare";
  if (/mvp/i.test(t)) return "MVP Health Care";
  return null;
}
export function productOf(plan: string): string {
  const p = plan.toLowerCase();
  if (/self.?insured|\baso\b|self.?funded/.test(p)) return "Self-insured";
  if (/\bppo\b|indemnity|blue care elect|choice plus|open access|\boap\b/.test(p)) return "PPO";
  if (/\bepo\b/.test(p)) return "EPO";
  if (/\bpos\b/.test(p)) return "POS";
  if (/\bhmo\b|blue new england|network blue|\bspirit\b|select|navigate/.test(p)) return "HMO";
  return "All plans";
}

type HptEntry = { location?: string; url: string; source?: string };
/** cms-hpt.txt: blocks of "key: value" lines; a block per hospital location. */
export function parseHpt(text: string): HptEntry[] {
  const out: HptEntry[] = [];
  let cur: Partial<HptEntry> = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*([a-z-]+)\s*:\s*(.+?)\s*$/i.exec(raw);
    if (!m) { if (cur.url) out.push(cur as HptEntry); cur = {}; continue; }
    const [, k, v] = m;
    if (/^location-name$/i.test(k)) { if (cur.url) { out.push(cur as HptEntry); cur = {}; } cur.location = v; }
    else if (/^mrf-url$/i.test(k)) cur.url = v;
    else if (/^source-page-url$/i.test(k)) cur.source = v;
  }
  if (cur.url) out.push(cur as HptEntry);
  return out.filter((e) => /^https?:\/\//.test(e.url)).map((e) => ({ ...e, location: e.location ?? "" }));
}

const basket = benchCodeMap();
export type Row = Omit<Prisma.HospitalRateCreateManyInput, "fileId" | "id">;

/** One item (a service with its codes and per-payer charges) → kept rows. */
function keep(codes: Array<{ code: string; type: string }>, setting: string | null, billingClass: string | null, payers: Array<{ payer: string; plan: string; dollar: number | null; pct: number | null; method: string | null; median?: number | null; gross?: number | null }>, ctx: { tin: string | null; hospital: string; state: string | null }, out: Row[]) {
  if (billingClass && /professional/i.test(billingClass)) return;
  const k = codes.map((c) => codeKey(c.type, c.code)).find((x) => basket.has(x));
  if (!k) return;
  const [codeType, code] = k.split("|");
  for (const p0 of payers) {
    // Percent-of-charges and algorithm contracts publish no dollar figure. Use, in order: the published dollar amount,
    // gross charge × the contracted percentage, then the median amount allowed (template v3) — last, because some
    // hospitals report one median across all payers.
    const frac = p0.pct == null ? null : p0.pct > 1.5 ? p0.pct / 100 : p0.pct;
    const byPct = frac && p0.gross ? p0.gross * frac : null;
    const derived = p0.dollar == null ? (byPct ?? (p0.median && p0.median > 0 ? p0.median : null)) : null;
    const p = { ...p0, dollar: p0.dollar ?? derived, method: derived != null ? `derived (${byPct ? "charge × %" : "median allowed"}) · ${p0.method ?? ""}`.trim() : p0.method };
    if (p.dollar == null && p.pct == null) continue;
    if (NON_COMMERCIAL.test(`${p.payer} ${p.plan}`)) continue;
    const carrier = carrierOf(p.payer, p.plan, ctx.state);
    if (!carrier) continue;
    // Carriers that are mostly Medicaid: a row counts as commercial only if the plan says so, otherwise their MassHealth
    // or RIte Care rates (a fraction of commercial) would be read as commercial prices.
    if (MEDICAID_HEAVY.has(carrier) && !COMMERCIAL_HINT.test(`${p.payer} ${p.plan}`)) continue;
    out.push({ tin: ctx.tin, hospital: ctx.hospital, state: ctx.state, codeType, code, setting, payer: p.payer.slice(0, 120), plan: p.plan.slice(0, 160) || null, carrier, product: productOf(p.plan), dollar: p.dollar, percentage: p.pct, methodology: p.method?.slice(0, 60) ?? null });
  }
}
const num = (v: unknown) => { const x = typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,%\s]/g, "")); return Number.isFinite(x) && String(v ?? "").trim() !== "" ? x : null; };

async function parseJson(file: string, ctx: { tin: string | null; hospital: string; state: string | null }, out: Row[]) {
  const stream = createReadStream(file).pipe(new Parser()).pipe(new Pick({ filter: "standard_charge_information" })).pipe(new StreamArray());
  for await (const { value } of stream as AsyncIterable<{ value: { code_information?: Array<{ code: string; type: string }>; standard_charges?: Array<Record<string, unknown>> } }>) {
    const codes = value.code_information ?? [];
    for (const sc of value.standard_charges ?? []) {
      const payers = ((sc.payers_information as Array<Record<string, unknown>>) ?? []).map((p) => ({
        payer: String(p.payer_name ?? ""), plan: String(p.plan_name ?? ""), dollar: num(p.standard_charge_dollar), pct: num(p.standard_charge_percentage), method: (p.methodology as string) ?? null,
        median: num(p.median_amount ?? p.estimated_amount), gross: num(sc.gross_charge),
      }));
      keep(codes, (sc.setting as string) ?? null, (sc.billing_class as string) ?? null, payers, ctx, out);
    }
  }
}

async function parseCsv(file: string, ctx: { tin: string | null; hospital: string; state: string | null }, out: Row[]) {
  // Rows 1–2: hospital metadata; row 3: column headers (CMS template v2/v3, "tall" or "wide").
  const parser = createReadStream(file).pipe(parse({ bom: true, relax_quotes: true, relax_column_count: true, skip_empty_lines: true, from_line: 3 }));
  let head: string[] | null = null;
  let wide: Array<{ i: number; payer: string; plan: string; kind: "dollar" | "pct" }> = [];
  const idx = (re: RegExp) => head!.findIndex((h) => re.test(h));
  let ix: Record<string, number> = {};
  for await (const row of parser as AsyncIterable<string[]>) {
    if (!head) {
      head = row.map((h) => h.trim().toLowerCase().replace(/\s*\|\s*/g, "|"));
      wide = head.flatMap((h, i) => { const m = /^standard_charge\|(.+)\|(.+)\|negotiated_(dollar|percentage)$/.exec(h); return m ? [{ i, payer: row[i].split("|")[1], plan: row[i].split("|")[2], kind: m[3] === "dollar" ? "dollar" as const : "pct" as const }] : []; });
      ix = { setting: idx(/^setting$/), bc: idx(/^billing_class$/), payer: idx(/^payer_name$/), plan: idx(/^plan_name$/), dollar: idx(/^standard_charge\|negotiated_dollar$/), pct: idx(/^standard_charge\|negotiated_percentage$/), method: idx(/^standard_charge\|methodology$/), median: idx(/^(median_amount|estimated_amount)$/), gross: idx(/^standard_charge\|gross$/) };
      continue;
    }
    const codes: Array<{ code: string; type: string }> = [];
    for (let n = 1; n <= 8; n++) {
      const c = head.indexOf(`code|${n}`), t = head.indexOf(`code|${n}|type`);
      if (c < 0) break;
      if (row[c]) codes.push({ code: row[c], type: row[t] ?? "" });
    }
    const get = (i: number) => (i >= 0 ? row[i] ?? "" : "");
    if (wide.length) {
      const byPlan = new Map<string, { payer: string; plan: string; dollar: number | null; pct: number | null; method: string | null }>();
      for (const w of wide) {
        const v = num(row[w.i]);
        if (v == null) continue;
        const key = `${w.payer}|${w.plan}`;
        const x = byPlan.get(key) ?? { payer: w.payer, plan: w.plan, dollar: null, pct: null, method: null };
        if (w.kind === "dollar") x.dollar = v; else x.pct = v;
        byPlan.set(key, x);
      }
      keep(codes, get(ix.setting) || null, get(ix.bc) || null, [...byPlan.values()], ctx, out);
    } else if (ix.payer >= 0) {
      keep(codes, get(ix.setting) || null, get(ix.bc) || null, [{ payer: get(ix.payer), plan: get(ix.plan), dollar: num(get(ix.dollar)), pct: num(get(ix.pct)), method: get(ix.method) || null, median: num(get(ix.median)), gross: num(get(ix.gross)) }], ctx, out);
    }
  }
}

/** First .json/.csv entry of a zip, extracted to a file. */
async function unzipFirst(zipPath: string, dir: string): Promise<string> {
  const zip = await new Promise<yauzl.ZipFile>((res, rej) => yauzl.open(zipPath, { lazyEntries: true }, (e, z) => (e ? rej(e) : res(z!))));
  return new Promise((resolve, reject) => {
    zip.on("entry", (e: yauzl.Entry) => {
      if (!/\.(json|csv)$/i.test(e.fileName)) return zip.readEntry();
      zip.openReadStream(e, (err, s) => {
        if (err || !s) return reject(err);
        const out = join(dir, `x.${e.fileName.split(".").pop()!.toLowerCase()}`);
        pipeline(s, createWriteStream(out)).then(() => { zip.close(); resolve(out); }, reject);
      });
    });
    zip.on("end", () => reject(new Error("no .json or .csv inside the zip")));
    zip.readEntry();
  });
}

/** Sniff the hospital name and last-updated date from the head of the file. */
async function sniff(file: string) {
  const fh = await open(file, "r");
  const buf = Buffer.alloc(8192);
  await fh.read(buf, 0, 8192, 0);
  await fh.close();
  const s = buf.toString("utf8").replace(/^﻿/, "");
  if (s.trimStart().startsWith("{")) {
    return { kind: "json" as const, name: /"hospital_name"\s*:\s*"([^"]+)"/.exec(s)?.[1] ?? null, updated: /"last_updated_on"\s*:\s*"([^"]+)"/.exec(s)?.[1] ?? null, version: /"version"\s*:\s*"([^"]+)"/.exec(s)?.[1] ?? null };
  }
  const lines = s.split(/\r?\n/);
  const values = (lines[1] ?? "").match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((v) => v.replace(/,$/, "").replace(/^"|"$/g, "")) ?? [];
  return { kind: "csv" as const, name: values[0] || null, updated: values[1] || null, version: values[2] || null };
}

/**
 * Files named "<EIN>_<hospital>_standardcharges" carry the TIN that rate files use. Otherwise match the hospital name to
 * CMS's hospital directory and take a TIN already mapped to that hospital (so Medicare comparisons are hospital-specific).
 */
const T = tinMap as { map: Record<string, string>; auto?: Record<string, string>; nonIpps?: Record<string, string> };
const CCN_TIN = new Map<string, string>();
for (const [tin, ccn] of Object.entries({ ...(T.auto ?? {}), ...(T.nonIpps ?? {}), ...T.map })) if (/^\d{9}$/.test(tin) && !CCN_TIN.has(ccn)) CCN_TIN.set(ccn, tin);
const normName = (s: string) => s.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]/g, " ").replace(/\b(INC|THE|CORP|CORPORATION|LLC)\b/g, "").replace(/\s+/g, " ").trim();
export function tinForHospital(name: string, state: string | null): string | null {
  const n = normName(name);
  const h = HOSPITALS.find((x) => (!state || x.state === state) && normName(x.name) === n) ?? HOSPITALS.find((x) => (!state || x.state === state) && n.length > 12 && (normName(x.name).startsWith(n) || n.startsWith(normName(x.name))));
  return h ? CCN_TIN.get(h.ccn) ?? null : null;
}

/** Where a processed file goes: the database (in the app) or a JSON-lines file (in the monthly GitHub extract). */
export type HptFileRecord = { domain: string; hospital: string; url: string; state: string | null; tin?: string | null; lastUpdated?: string | null; version?: string | null; status: string; error: string | null; rows: number; payers?: unknown; processedAt: Date };
export type HptSink = { save(id: string, file: HptFileRecord, rows: Row[] | null): Promise<void>; fresh?(id: string): Promise<boolean> };

export const dbSink: HptSink = {
  async save(id, file, rows) {
    const data = { ...file, payers: (file.payers ?? undefined) as Prisma.InputJsonValue | undefined };
    if (!rows) { await db.hospitalFile.upsert({ where: { id }, create: { id, ...data }, update: data }); return; }
    await db.$transaction(async (tx) => {
      await tx.hospitalRate.deleteMany({ where: { fileId: id } });
      for (let i = 0; i < rows.length; i += 2000) await tx.hospitalRate.createMany({ data: rows.slice(i, i + 2000).map((r) => ({ ...r, fileId: id })) });
      await tx.hospitalFile.upsert({ where: { id }, create: { id, ...data }, update: data });
    }, { timeout: 300_000 });
  },
  async fresh(id) { const prev = await db.hospitalFile.findUnique({ where: { id } }); return prev?.status === "ok" && Date.now() - prev.processedAt.getTime() < 25 * 864e5; },
};

export async function importHospitalFiles(opts: { domains?: string[]; force?: boolean; sink?: HptSink } = {}): Promise<number> {
  const sink = opts.sink ?? dbSink;
  const dir = await mkdtemp(join(tmpdir(), "hpt-"));
  let total = 0;
  try {
    // Files saved by hand from sites that refuse automated visits (docs/MANUAL-MRF.md).
    let manual: Awaited<ReturnType<typeof manualFiles>>["hpt"] = [];
    try { manual = (await manualFiles()).hpt; } catch { /* manual uploads are optional */ }
    for (const { domain, state } of HPT_DOMAINS.filter((d) => !opts.domains || opts.domains.includes(d.domain))) {
      let entries: HptEntry[] = [];
      const byHand = manual.filter((m) => m.domain === domain.replace(/^www\./, "") || m.domain === domain);
      if (byHand.length) entries = byHand.map((m) => ({ url: m.url }));
      else try {
        const res = await fetch(`https://${domain}/cms-hpt.txt`, { headers: UA, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`cms-hpt.txt: HTTP ${res.status}`);
        entries = parseHpt(await res.text());
        if (!entries.length) throw new Error("cms-hpt.txt lists no machine-readable file");
      } catch (e) {
        const id = createHash("sha1").update(domain).digest("hex").slice(0, 16);
        await sink.save(id, { domain, hospital: domain, url: `https://${domain}/cms-hpt.txt`, state, status: "failed", error: (e as Error).message.slice(0, 300), rows: 0, processedAt: new Date() }, null);
        continue;
      }
      const urls = [...new Map(entries.map((e) => [e.url, e])).values()];
      for (const e of urls) {
        const id = createHash("sha1").update(e.url).digest("hex").slice(0, 16);
        if (!opts.force && (await sink.fresh?.(id))) continue; // monthly
        const tin = /(?:^|\/)(\d{9})[_-]/.exec(decodeURIComponent(e.url))?.[1] ?? null;
        let rows: Row[] = [];
        try {
          const res = await fetch(e.url, { headers: UA, signal: AbortSignal.timeout(30 * 60_000) });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          const len = Number(res.headers.get("content-length") ?? 0);
          if (len > MAX_BYTES) throw new Error(`file is ${(len / 1e9).toFixed(1)} GB — over the ${MAX_BYTES / 1e9} GB limit`);
          const raw = join(dir, "raw");
          await pipeline(Readable.fromWeb(res.body as never), createWriteStream(raw));
          const isZip = (await (async () => { const fh = await open(raw, "r"); const b = Buffer.alloc(2); await fh.read(b, 0, 2, 0); await fh.close(); return b.toString() === "PK"; })());
          const file = isZip ? await unzipFirst(raw, dir) : raw;
          const meta = await sniff(file);
          const hospital = meta.name ?? e.location ?? domain;
          const ctx = { tin: tin ?? tinForHospital(hospital, state) ?? (e.location ? tinForHospital(e.location, state) : null), hospital, state };
          if (meta.kind === "json") await parseJson(file, ctx, rows); else await parseCsv(file, ctx, rows);
          const bytes = (await stat(file)).size;
          // Payer/plan inventory for the disclosure panel.
          const inv = new Map<string, { payer: string; plan: string | null; carrier: string | null; product: string | null; rows: number }>();
          for (const r of rows) { const k = `${r.payer}|${r.plan}`; const x = inv.get(k) ?? { payer: r.payer, plan: r.plan ?? null, carrier: r.carrier ?? null, product: r.product ?? null, rows: 0 }; x.rows++; inv.set(k, x); }
          await sink.save(id, { domain, hospital, url: e.url, state, tin: ctx.tin, lastUpdated: meta.updated ?? null, version: meta.version ?? null, status: rows.length ? "ok" : "skipped", error: rows.length ? null : `no commercial basket prices found (${(bytes / 1e6).toFixed(0)} MB parsed)`, rows: rows.length, payers: [...inv.values()], processedAt: new Date() }, rows);
          total += rows.length;
        } catch (err) {
          await sink.save(id, { domain, hospital: e.location || domain, url: e.url, state, tin, status: "failed", error: (err as Error).message.slice(0, 300), rows: 0, processedAt: new Date() }, null);
        } finally {
          rows = [];
          await rm(join(dir, "raw"), { force: true }); await rm(join(dir, "x.json"), { force: true }); await rm(join(dir, "x.csv"), { force: true });
        }
      }
    }
    return total;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
