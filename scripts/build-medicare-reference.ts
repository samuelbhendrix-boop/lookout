/**
 * Builds data/medicare/reference.json — Medicare's price for every benchmark service, the yardstick for "% of Medicare".
 * Run once a year (or when CMS posts a new quarter) against the unzipped CMS files:
 *
 *   npx tsx scripts/build-medicare-reference.ts <dir-with-unzipped-cms-files>
 *
 * Inputs (all public, cms.gov):
 *   PFS RVU file (rvu26d): PPRRVU2026_Oct_nonQPP.csv, GPCI2026.csv
 *   OPPS Addendum B (October 2026): 508-compliant-version-*_Addendum_B*.txt
 *   CLFS (26CLABQ4): PUF_CLFS_CY2026_Q4V1.csv
 *   IPPS FY2027 final rule: Table 5 (MS-DRG weights), Tables 1A–1E (standardized amounts), Impact File (per-hospital factors)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { BENCH_CODES } from "../lib/marketdata/mrf/codes";

const dir = process.argv[2];
if (!dir) { console.error("usage: tsx scripts/build-medicare-reference.ts <dir>"); process.exit(1); }
const find = (re: RegExp) => { const f = readdirSync(dir).find((n) => re.test(n)); if (!f) throw new Error(`missing ${re}`); return join(dir, f); };
const num = (s: string | undefined) => { const v = Number(String(s ?? "").replace(/[$,"\s]/g, "")); return Number.isFinite(v) ? v : null; };
const cpts = new Set([...BENCH_CODES.filter((c) => c.type === "CPT").map((c) => c.code), "G0463"]);

// ── PFS ──
const pfsRows = parse(readFileSync(find(/^PPRRVU\d+_\w+_nonQPP\.csv$/)), { relax_column_count: true, relax_quotes: true }) as string[][];
const hdr = pfsRows.findIndex((r) => r[0] === "HCPCS");
const pfs: Record<string, { status: string; work: number; peNonFac: number | null; peFac: number; mp: number }> = {};
let cf = 0;
for (const r of pfsRows.slice(hdr + 1)) {
  if (!cpts.has(r[0]) || r[1]) continue; // global (no modifier) only
  pfs[r[0]] = { status: r[3], work: num(r[5]) ?? 0, peNonFac: r[7] === "NA" ? null : num(r[6]), peFac: num(r[8]) ?? 0, mp: num(r[10]) ?? 0 };
  cf = num(r[25]) ?? cf;
}
const gpci = (parse(readFileSync(find(/^GPCI\d+\.csv$/)), { relax_column_count: true }) as string[][])
  .filter((r) => ["MA", "CT", "ME", "NH", "RI", "VT"].includes(r[1]))
  .map((r) => ({ state: r[1], locality: r[3], work: num(r[4])!, pe: num(r[5])!, mp: num(r[6])! }));

// ── OPPS Addendum B ──
const addB = readFileSync(find(/Addendum_B.*\.txt$/), "latin1").split(/\r?\n/).map((l) => l.split("\t"));
const opps: Record<string, { si: string; apc: string | null; rate: number | null }> = {};
for (const r of addB) if (cpts.has(r[0])) opps[r[0]] = { si: r[2], apc: r[3] || null, rate: num(r[5]) };

// ── CLFS ──
const clfsRows = parse(readFileSync(find(/^PUF_CLFS_.*\.csv$/)), { relax_column_count: true, relax_quotes: true }) as string[][];
const clfs: Record<string, number> = {};
for (const r of clfsRows) if (cpts.has(r[1]) && !r[2] && num(r[5])) clfs[r[1]] = num(r[5])!;

// ── IPPS ──
const t5 = readFileSync(find(/^CMS-\d+-CN Table 5\.txt$/), "latin1").split(/\r?\n/).map((l) => l.split("\t"));
const weights: Record<string, number> = {};
for (const r of t5) if (/^\d{3}$/.test(r[0]) && num(r[7])) weights[r[0]] = num(r[7])!;
const t1 = readFileSync(find(/^CMS-\d+-CN Tables 1A - 1E\.txt$/), "latin1");
const amounts = [...t1.matchAll(/\$([\d,]+\.\d\d)/g)].map((m) => num(m[1])!);
// Table 1A (wage index > 1) and 1B (≤ 1), "submitted quality data and meaningful EHR user" columns; 1D capital.
const ipps = { laborHigh: amounts[0], nonlaborHigh: amounts[1], laborLow: amounts[8], nonlaborLow: amounts[9], capital: [...t1.matchAll(/National\s+\$([\d,]+\.\d\d)/g)].map((m) => num(m[1])!)[0] };

const impact = readFileSync(find(/Impact File - Correction Notice\.txt$/), "latin1").split(/\r?\n/).map((l) => l.split("\t"));
const ih = impact[1];
const col = (n: string) => { const i = ih.indexOf(n); if (i < 0) throw new Error(`impact column ${n}`); return i; };
const NE = { "07": "CT", "20": "ME", "22": "MA", "30": "NH", "41": "RI", "47": "VT" } as Record<string, string>;
const hospitals: Record<string, Record<string, string | number>> = {};
for (const r of impact.slice(2)) {
  const st = NE[r[0]?.slice(0, 2)];
  if (!st || !r[1]) continue;
  hospitals[r[0]] = {
    name: r[1], state: st, wageIndex: num(r[col("FY 2027 Wage Index")])!, gaf: num(r[col("GAF")])!,
    tchop: num(r[col("TCHOP")]) ?? 0, tchcp: num(r[col("TCHCP")]) ?? 0, dshopp: num(r[col("DSHOPP")]) ?? 0, dshcpp: num(r[col("DSHCPP")]) ?? 0,
    ucpPerClaim: num(r[col("UCP Per Claim Amount")]) ?? 0,
    vbp: num(r[col("Proxy Value Based Purchasing Adjustment Factor")]) ?? 1, readm: num(r[col("Proxy Readmission Adjustment Factor")]) ?? 1,
  };
}
const ma = Object.values(hospitals).filter((h) => h.state === "MA");
const avg = (k: string) => ma.reduce((s, h) => s + (h[k] as number), 0) / ma.length;
const stateAverages = Object.fromEntries(Object.values(NE).map((st) => {
  const hs = Object.values(hospitals).filter((h) => h.state === st);
  const a = (k: string) => hs.reduce((s, h) => s + (h[k] as number), 0) / hs.length;
  return [st, { wageIndex: a("wageIndex"), gaf: a("gaf"), hospitals: hs.length }];
}));

const aprCrosswalk: Record<string, string[]> = { "302": ["469", "470"], "301": ["469", "470"], "560": ["805", "806", "807"], "540": ["786", "787", "788"], "720": ["871", "872"], "194": ["291", "292", "293"], "139": ["193", "194", "195"], "175": ["321", "322"], "640": ["795"] };
const needed = new Set([...BENCH_CODES.filter((c) => c.type === "MS-DRG").map((c) => c.code), ...Object.values(aprCrosswalk).flat()]);
for (const k of Object.keys(weights)) if (!needed.has(k)) delete weights[k];
const out = {
  _about: "Medicare reference prices for Lookout's benchmark basket. Generated by scripts/build-medicare-reference.ts from public CMS files; do not hand-edit.",
  generated: new Date().toISOString().slice(0, 10),
  sources: [
    { name: "Physician Fee Schedule RVU file (RVU26D, Oct 2026), non-QPP conversion factor", url: "https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files/rvu26d" },
    { name: "OPPS Addendum B, October 2026", url: "https://www.cms.gov/medicare/payment/prospective-payment-systems/hospital-outpatient-pps/quarterly-addenda-updates/october-2026-addendum-b" },
    { name: "Clinical Laboratory Fee Schedule, CY2026 Q4", url: "https://www.cms.gov/medicare/payment/fee-schedules/clinical-laboratory-fee-schedule-clfs/files/26clabq4" },
    { name: "IPPS FY2027 final rule + correction notice: Table 5, Tables 1A–1E, Impact File", url: "https://www.cms.gov/medicare/payment/prospective-payment-systems/acute-inpatient-pps/fy-2027-ipps-final-rule-home-page" },
  ],
  pfs: { conversionFactor: cf, gpci, codes: pfs },
  opps: { laborShare: 0.6, codes: opps },
  clfs,
  ipps: { ...ipps, weights },
  /** APR-DRG has no Medicare equivalent; each maps to the MS-DRG family covering the same condition (severity splits averaged). */
  aprCrosswalk,
  massachusettsAverage: { wageIndex: avg("wageIndex"), gaf: avg("gaf"), hospitals: ma.length },
  stateAverages,
  hospitals,
};
const missing = BENCH_CODES.filter((c) => c.type === "MS-DRG" && !weights[c.code]).map((c) => c.code);
if (missing.length) console.warn("MS-DRGs without weights:", missing);
writeFileSync("data/medicare/reference.json", JSON.stringify(out, null, 1));
console.log({ cf, gpci: gpci.length, pfs: Object.keys(pfs).length, opps: Object.keys(opps).length, clfs: Object.keys(clfs).length, weights: Object.keys(weights).length, ipps, hospitals: Object.keys(hospitals).length, ma: out.massachusettsAverage });
