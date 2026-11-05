import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import type { Funding, Prisma, Segment } from "@prisma/client";
import { db } from "../db";

/**
 * State large-group sources (fill the gaps CMS data leaves — above all, self-insured business):
 *  - MA CHIA Enrollment Trends databook: members by payer × funding (fully/self-insured) × product × group size.
 *    Structured Excel, published semiannually → imported automatically.
 *  - ME BOI, RI OHIC, NH NHID: published as PDFs → curated, arithmetic-checked snapshots in
 *    data/state-large-group/*.json (see tests). Update by editing the JSON when a new edition is out.
 */

// ─── MA CHIA ─────────────────────────────────────────────────────────

/** CHIA payer codes (they change between editions) → names that issuer patterns match. */
export const CHIA_PAYERS: Record<string, string> = {
  BCBS: "Blue Cross and Blue Shield of Massachusetts",
  BCBSMA: "Blue Cross and Blue Shield of Massachusetts",
  HPHC: "Harvard Pilgrim Health Care",
  Tufts: "Tufts Health Plan",
  THPP: "Tufts Health Public Plans",
  United: "UnitedHealthcare",
  CIGNA: "Cigna",
  Aetna: "Aetna",
  Anthem: "Elevance Health (Anthem)",
  "Elevance Health": "Elevance Health (Anthem)",
  HNE: "Health New England",
  MGBHP: "Mass General Brigham Health Plan",
  AllWays: "Mass General Brigham Health Plan",
  WellSense: "WellSense Health Plan",
  BMCHP: "WellSense Health Plan",
  Fallon: "Fallon Community Health Plan",
};

/** CHIA market sectors → segment. In MA, 51–100 is large group (merged market = 1–50). */
export function chiaSegment(sector: string): Segment | null {
  if (/jumbo|large group|mid-size/i.test(sector)) return "LARGE_GROUP";
  if (/small group/i.test(sector)) return "SMALL_GROUP";
  if (/^individual/i.test(sector)) return "INDIVIDUAL";
  return null; // "Other" etc.
}

export function chiaFunding(v: string): Funding | null {
  if (/self/i.test(v)) return "SELF_INSURED";
  if (/fully/i.test(v)) return "FULLY_INSURED";
  return null;
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (typeof v === "object" && "richText" in v) return v.richText.map((r) => r.text).join("");
  if (typeof v === "object" && "result" in v) return String(v.result ?? "");
  return String(v);
};

export async function importChia(zipOrXlsxPath: string): Promise<number> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(zipOrXlsxPath);
  const ws = wb.getWorksheet("3");
  if (!ws) throw new Error("CHIA databook: tab 3 (commercial enrollment by payer) not found");

  // Header row moves between editions — find it.
  let col: Record<string, number> | null = null;
  const out = new Map<string, Prisma.MarketEnrollmentCreateManyInput>();
  ws.eachRow((row) => {
    // row.values is sparse (empty cells are holes) — Array.from fills them so indexes line up.
    const raw = Array.from(row.values as ExcelJS.CellValue[]);
    const vals = raw.map(cellText);
    if (!col) {
      if (vals[1]?.trim() === "Payer" && vals.some((v) => /members/i.test(v))) {
        col = Object.fromEntries(vals.map((v, i) => [v.trim().toLowerCase(), i]));
      }
      return;
    }
    const date = raw[col["date"]];
    if (!(date instanceof Date)) return;
    const payerCode = vals[col["payer"]].trim();
    const funding = chiaFunding(vals[col["funding type"]]);
    const sector = vals[col["market sector"]].trim();
    const segment = chiaSegment(sector);
    const members = Number(raw[col["members"]]);
    if (!payerCode || !funding || !segment || !Number.isFinite(members)) return;
    const payer = CHIA_PAYERS[payerCode] ?? payerCode;
    const productType = vals[col["product type"]]?.trim() ?? "";
    const asOf = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const key = [asOf.toISOString(), payer, funding, sector, productType].join("|");
    const prev = out.get(key);
    out.set(key, {
      source: "ma_chia", state: "MA", asOf, payer, funding, segment, sector, productType,
      members: (prev?.members ?? 0) + members, // BCBS + BCBSMA style duplicates merge
    });
  });
  if (!col) throw new Error("CHIA databook: header row not found");

  const rows = [...out.values()];
  const dates = [...new Set(rows.map((r) => (r.asOf as Date).toISOString()))].map((d) => new Date(d));
  // Newer editions restate overlapping quarters — replace those quarters wholesale.
  await db.marketEnrollment.deleteMany({ where: { source: "ma_chia", asOf: { in: dates } } });
  for (let i = 0; i < rows.length; i += 1000) await db.marketEnrollment.createMany({ data: rows.slice(i, i + 1000) });
  return rows.length;
}

// ─── curated snapshots ───────────────────────────────────────────────

type MeFile = { source: string; state: string; segment: Segment; rows: Array<{ company: string; year: number; coveredLives: number | null; memberMonths: number | null; premium: number; claims: number; reserveChange: number | null; adminExpense: number | null; underwritingGain: number | null; isTotal: boolean }> };
type RiFile = { source: string; state: string; segment: Segment; actions: Array<{ planYear: number; label: string; carrier: string; members: number | null; requested: number | null; approved: number | null; details: Record<string, number> | null; isTotal: boolean }> };
type NhFile = { source: string; state: string; segment: Segment; rows: Array<{ year: number; funding: Funding; payer: string; sharePct: number; segmentTotal: number; note: string | null }> };

export const SNAPSHOT_DIR = () => join(process.cwd(), "data", "state-large-group");

export async function loadSnapshot<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(join(SNAPSHOT_DIR(), file), "utf8")) as T;
}

export async function importStateSnapshots(): Promise<number> {
  const me = await loadSnapshot<MeFile>("me-boi.json");
  const ri = await loadSnapshot<RiFile>("ri-ohic.json");
  const nh = await loadSnapshot<NhFile>("nh-nhid.json");

  await db.stateFinancial.deleteMany({ where: { source: me.source } });
  await db.stateFinancial.createMany({
    data: me.rows.map((r) => ({ source: me.source, state: me.state, segment: me.segment, ...r })),
  });

  await db.groupRateAction.deleteMany({ where: { source: ri.source } });
  await db.groupRateAction.createMany({
    data: ri.actions.map((a) => ({
      source: ri.source, state: ri.state, segment: ri.segment, planYear: a.planYear, carrier: a.carrier, label: a.label,
      members: a.members, requested: a.requested, approved: a.approved, isTotal: a.isTotal,
      details: (a.details ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });

  await db.marketEnrollment.deleteMany({ where: { source: nh.source } });
  await db.marketEnrollment.createMany({
    data: nh.rows.map((r) => ({
      source: nh.source, state: nh.state, segment: nh.segment, asOf: new Date(Date.UTC(r.year, 11, 31)),
      payer: r.payer, funding: r.funding, sector: "Large group (situs)", productType: "",
      members: Math.round((r.sharePct / 100) * r.segmentTotal), estimated: true, note: r.note,
    })),
  });
  return me.rows.length + ri.actions.length + nh.rows.length;
}
