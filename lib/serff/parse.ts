import ExcelJS from "exceljs";
import { claudeJson } from "../ai";
import { db } from "../db";

/**
 * SERFF filings, uploaded by a user (SERFF Filing Access blocks automated download). A filing arrives as the main
 * PDF (SERFF's "PDF Pipeline" export) plus its attachments. What we keep:
 *  - the main PDF: header (tracking #, state, company, TOI, product, dates, disposition), plans, rate change, description
 *  - geo-access "Access Analysis" workbooks: members and adequacy by network, county and provider type
 *  - the Plan ID Crosswalk: where each plan's members go next year (renew, map, discontinue)
 *  - regulator objection letters and responses: summarised with the description
 * Everything else (formulary tools, attestations, rate review templates CMS already publishes) is ignored.
 */
export type UploadedFile = { name: string; data: Buffer };

export const KEEP = (name: string) => {
  const n = name.toLowerCase();
  if (!/\.(pdf|xlsx|xlsm|xls|csv)$/.test(n) || n.split("/").pop()!.startsWith("._")) return false;
  if (/access maps|drug|formulary|adverse tiering|data integrity|data consolidation|segregation|attestation|usage agreement|qis|av screenshots|prescriptiondrug|issuerurl|prov directory|unified_rate_review|unifiedratereview/.test(n)) return false;
  return true;
};

const pdfText = async (data: Buffer) => {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(data), { verbosity: 0 } as never);
  return String((await extractText(doc, { mergePages: true })).text);
};

// SERFF's PDF puts several "Label: value" pairs on one line; a value ends where the next known label starts.
const LABELS = ["SERFF Tracking #", "State Tracking #", "Company Tracking #", "Filing Company", "TOI/Sub-TOI", "Sub-TOI", "TOI", "Product Name", "Project Name/Number", "Plan Binder Name", "Plan Year", "Market Type", "Binder Type", "Company Name", "Company", "State", "Group Market Size", "Group Market Type", "Filing Type", "Date Submitted", "SERFF Tr Num", "SERFF Status", "State Tr Num", "State Status", "Co Tr Num", "Disposition Date", "Disposition Status", "Effective Date", "Author\\(s\\)", "Reviewer\\(s\\)", "Authors", "Reviewers"];
const esc = (l: string) => l.replace(/[#/]/g, (c) => `\\${c}`);
const NEXT = `(?=\\s+(?:${LABELS.map(esc).join("|")})\\s*:|\\n|$)`;
const field = (t: string, label: string) => {
  const m = t.match(new RegExp(`(?:^|\\n|\\s)(?<!Filing |Issuer |Tracking |Co )${esc(label)}\\s*:[ \\t]*(.*?)${NEXT}`, "i"));
  const v = m?.[1]?.trim();
  return v ? v : null;
};
/** Every sheet of a workbook as rows of plain values (formula results, rich text flattened). */
async function sheets(data: Buffer): Promise<Array<{ name: string; rows: unknown[][] }>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as never);
  const val = (v: ExcelJS.CellValue): unknown => {
    if (v == null) return null;
    if (typeof v === "object") {
      if ("result" in v) return val((v as { result: ExcelJS.CellValue }).result);
      if ("richText" in v) return (v as { richText: Array<{ text: string }> }).richText.map((x) => x.text).join("");
      if ("text" in v) return (v as { text: string }).text;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return null;
    }
    return v;
  };
  return wb.worksheets.map((ws) => { const rows: unknown[][] = []; ws.eachRow({ includeEmpty: true }, (r, i) => { rows[i - 1] = (r.values as ExcelJS.CellValue[]).slice(1).map(val); }); return { name: ws.name, rows: Array.from(rows, (r) => r ?? []) }; });
}

const date = (s: string | null) => { const m = s?.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? new Date(Date.UTC(+m[3], +m[1] - 1, +m[2])) : null; };

/** Geo-access workbook → rows. The network comes from the file name ("… PY27 Focus MA HMO A013 Access Analysis"). */
export async function parseAccess(name: string, data: Buffer) {
  const base = name.split("/").pop()!.replace(/\.(xlsx|xlsm|xls)$/i, "");
  const network = base.replace(/access analysis/i, "").replace(/^.*?PY\d{2}\s+/i, "").replace(/\s+/g, " ").trim() || base;
  const out: Array<{ network: string; state: string | null; county: string; specialty: string; members: number | null; withAccess: number | null; pct: number | null }> = [];
  for (const { rows } of await sheets(data)) {
    const h = rows.findIndex((r) => Array.isArray(r) && r.some((c) => /county name/i.test(String(c))) && r.some((c) => /specialty/i.test(String(c))));
    if (h < 0) continue;
    const head = (rows[h] as unknown[]).map((c) => String(c ?? "").toLowerCase());
    const col = (re: RegExp) => head.findIndex((c) => re.test(c));
    const cSpecName = col(/specialty (group )?name/);
    const [cCounty, cState, cSpec, cMem, cWith, cPct] = [col(/county name/), col(/^state/), cSpecName >= 0 ? cSpecName : col(/specialty/), col(/membership count|members$/), col(/# members with access/), col(/% members with access|percent/)];
    for (const r of rows.slice(h + 1) as unknown[][]) {
      if (!r?.[cCounty] || !r?.[cSpec]) continue;
      const num = (i: number) => (i >= 0 && r[i] != null && r[i] !== "" && Number.isFinite(Number(r[i])) ? Number(r[i]) : null);
      out.push({ network, state: cState >= 0 ? String(r[cState] ?? "") || null : null, county: String(r[cCounty]), specialty: String(r[cSpec]), members: num(cMem), withAccess: num(cWith), pct: num(cPct) });
    }
  }
  return out;
}

/** Plan ID Crosswalk workbook → rows (the "<next year> Plan Crosswalk" sheet). */
export async function parseCrosswalk(data: Buffer) {
  const out: Array<{ fromPlan: string; toPlan: string | null; reason: string | null; level: string | null }> = [];
  for (const { rows } of (await sheets(data)).filter((s) => /crosswalk/i.test(s.name))) {
    const h = rows.findIndex((r) => Array.isArray(r) && r.some((c) => /reason for crosswalk/i.test(String(c))));
    if (h < 0) continue;
    const head = (rows[h] as unknown[]).map((c) => String(c ?? "").toLowerCase());
    const cFrom = head.findIndex((c) => /hios plan ?id/.test(c) && !/crosswalk plan/.test(c));
    const cTo = head.findIndex((c) => /crosswalk plan/.test(c));
    const cReason = head.findIndex((c) => /reason for crosswalk/.test(c));
    const cLevel = head.findIndex((c) => /crosswalk level/.test(c));
    for (const r of rows.slice(h + 1) as unknown[][]) {
      const from = String(r?.[cFrom] ?? "").trim();
      if (!/^\d{5}[A-Z]{2}\d{7}$/.test(from)) continue;
      out.push({ fromPlan: from, toPlan: String(r[cTo] ?? "").trim() || null, reason: String(r[cReason] ?? "").trim() || null, level: cLevel >= 0 ? String(r[cLevel] ?? "").trim() || null : null });
    }
  }
  return out;
}

const SCHEMA = {
  type: "object", required: ["summary", "newProduct"],
  properties: {
    company: { type: ["string", "null"] }, productName: { type: ["string", "null"] }, market: { type: ["string", "null"], enum: ["Individual", "Small Group", "Large Group", "Group", "Other", null] },
    filingType: { type: ["string", "null"] }, planYear: { type: ["integer", "null"] }, disposition: { type: ["string", "null"] },
    newProduct: { type: "boolean" }, rateChange: { type: ["number", "null"], description: "overall approved (else requested) rate change as a fraction, e.g. 0.094" },
    summary: { type: "string", description: "3-5 sentences: what is filed, what is new or changed, network and plan-design features, anything notable for a competitor" },
    plans: { type: "array", items: { type: "object", properties: { id: { type: ["string", "null"] }, name: { type: "string" }, metal: { type: ["string", "null"] }, network: { type: ["string", "null"] }, status: { type: ["string", "null"] } }, required: ["name"] } },
    networks: { type: "array", items: { type: "string" } },
    objections: { type: ["string", "null"], description: "what the regulator objected to and how the company responded, 1-3 sentences; null if none" },
  },
};

/** Parse and store one uploaded filing (main PDF + attachments). Returns the stored filing id. */
export async function ingestFiling(files: UploadedFile[], uploadedBy: string | null): Promise<{ id: string; tracking: string; access: number; crosswalk: number }> {
  const kept = files.filter((f) => KEEP(f.name));
  const pdfs = kept.filter((f) => /\.pdf$/i.test(f.name));
  // The main PDF is SERFF's export: it names the tracking number on every page.
  const texts = await Promise.all(pdfs.map(async (f) => ({ f, t: await pdfText(f.data).catch(() => "") })));
  const main = texts.find((x) => /SERFF Tracking\s*#/i.test(x.t) && /(Filing at a Glance|Binder at a Glance)/i.test(x.t)) ?? texts.find((x) => /SERFF Tracking\s*#/i.test(x.t));
  if (!main) throw new Error("No SERFF filing PDF found (the main PDF exported from SERFF Filing Access, with \"SERFF Tracking #\" on each page).");
  const t = main.t;
  const tracking = t.match(/SERFF Tracking\s*#\s*:?\s*([A-Z0-9]+-[A-Z0-9-]+)/i)?.[1] ?? t.match(/SERFF Tr Num\s*:?\s*([A-Z0-9-]+)/i)?.[1];
  if (!tracking) throw new Error("Couldn't find the SERFF tracking number in the filing PDF.");
  const stateName = field(t, "State");
  const toiLine = field(t, "TOI/Sub-TOI") ?? field(t, "TOI");
  const [toi, subToi] = (toiLine ?? "").split("/").map((s) => s.trim());

  // Objection letters and responses go to the AI read alongside the main text.
  const extra = texts.filter((x) => x !== main && /objection|response|correspondence|unique plan design|justification/i.test(x.f.name)).map((x) => `\n\n=== ${x.f.name.split("/").pop()}\n${x.t.slice(0, 8000)}`).join("");
  const ai = await claudeJson({
    label: "serff filing", tool: "record_filing", schema: SCHEMA, maxTokens: 4000,
    system: "You read U.S. state insurance filings (SERFF exports) for a competitive-intelligence team at a New England health insurer. Extract the fields; use null when the filing doesn't say. A filing is a new product when SERFF's rate section says 'New Product', the description says a new product/plan/network is introduced, or plan IDs are new rather than renewals.",
    user: `MAIN FILING:\n${t.slice(0, 40000)}${extra.slice(0, 30000)}`,
  });
  const a = (ai?.data ?? {}) as { company?: string; productName?: string; market?: string; filingType?: string; planYear?: number; disposition?: string; newProduct?: boolean; rateChange?: number | null; summary?: string; plans?: unknown[]; networks?: string[]; objections?: string | null };

  const access = (await Promise.all(kept.filter((f) => /access analysis/i.test(f.name) && /\.xls/i.test(f.name)).map((f) => parseAccess(f.name, f.data).catch(() => [])))).flat();
  const crosswalk = (await Promise.all(kept.filter((f) => /xwalk|crosswalk/i.test(f.name) && /\.xls/i.test(f.name)).map((f) => parseCrosswalk(f.data).catch(() => [])))).flat();
  const st = (stateName ?? "").trim();
  const STATES: Record<string, string> = { massachusetts: "MA", connecticut: "CT", "rhode island": "RI", "new hampshire": "NH", maine: "ME", vermont: "VT" };
  const data = {
    state: STATES[st.toLowerCase()] ?? (st.length === 2 ? st.toUpperCase() : st || null),
    company: a.company ?? field(t, "Filing Company") ?? field(t, "Company Name") ?? field(t, "Company"),
    toi: toi || null, subToi: subToi || null,
    market: a.market ?? (/large/i.test(field(t, "Group Market Size") ?? "") ? "Large Group" : /small/i.test(field(t, "Group Market Size") ?? "") ? "Small Group" : field(t, "Market Type")),
    filingType: a.filingType ?? field(t, "Filing Type") ?? (/Binder/i.test(t) ? "Plan Binder" : null),
    productName: a.productName ?? field(t, "Product Name") ?? field(t, "Plan Binder Name"),
    planYear: a.planYear ?? (Number(field(t, "Plan Year")) || null),
    submitted: date(field(t, "Date Submitted")),
    disposition: a.disposition ?? field(t, "Disposition Status") ?? field(t, "SERFF Status"),
    dispositionAt: date(field(t, "Disposition Date")),
    newProduct: !!a.newProduct || /New Product/.test(t),
    rateChange: typeof a.rateChange === "number" ? a.rateChange : null,
    summary: a.summary ?? null,
    detail: JSON.parse(JSON.stringify({ plans: a.plans ?? [], networks: a.networks ?? [...new Set(access.map((x) => x.network))], objections: a.objections ?? null, description: t.match(/Filing Description:\s*([\s\S]{20,4000}?)(?=\n(?:Company and Contact|Filing Contact Information|Filing Fees|Rate Information|SERFF Tracking #)|$)/)?.[1]?.split("\n").filter((l) => !/^(SERFF Tracking #|State:|TOI\/Sub-TOI|Product Name:|Project Name\/Number|PDF Pipeline|General Information)/.test(l.trim())).join("\n").trim() ?? null, aiModel: ai?.model ?? null })),
    files: JSON.parse(JSON.stringify(files.map((f) => ({ name: f.name.split("/").pop(), kept: KEEP(f.name), bytes: f.data.length })))),
    uploadedBy,
  };
  const filing = await db.serffFiling.upsert({ where: { tracking }, create: { tracking, ...data }, update: data });
  await db.$transaction([
    db.serffNetworkAccess.deleteMany({ where: { filingId: filing.id } }),
    db.serffCrosswalk.deleteMany({ where: { filingId: filing.id } }),
    db.serffNetworkAccess.createMany({ data: access.map((x) => ({ ...x, filingId: filing.id })) }),
    db.serffCrosswalk.createMany({ data: crosswalk.map((x) => ({ ...x, filingId: filing.id })) }),
  ]);
  return { id: filing.id, tracking, access: access.length, crosswalk: crosswalk.length };
}
