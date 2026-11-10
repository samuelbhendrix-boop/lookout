/**
 * Builds data/gic/gic-fyYYYY.json from the MA Group Insurance Commission's public documents:
 *  - the state employees' benefit guide (plan designs: "Benefits-at-a-Glance"), and
 *  - the March commission meeting slides (full-cost monthly premiums, prior year, increase, projected enrollment).
 *
 *   npx tsx scripts/build-gic.ts 2027 <guide.pdf> <slides.pdf>
 *
 * Needs `pdftotext` (poppler). Run each spring when GIC posts the new fiscal year (rates effective July 1).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type GicPlan = {
  id: string; name: string; product: string; carrier: string; network: string; type: string;
  design: Record<string, string>;
  premium: { individual: Tier; family: Tier };
};
type Tier = { prior: number | null; current: number | null; change: number | null; enrollment: number | null };

/** Column order of the "Benefits-at-a-Glance" table and how each plan is named elsewhere. */
export const GIC_PLANS: Array<{ id: string; network: string; product: string; carrier: string; header: RegExp; slide: RegExp }> = [
  { id: "hp-access-america", network: "National", product: "Harvard Pilgrim Access America", carrier: "Harvard Pilgrim Health Care", header: /ACCESS AMERICA/, slide: /Access\s*America|Harvard Pilgrim Access/ },
  { id: "wp-total-choice", network: "Broad", product: "Wellpoint Total Choice", carrier: "Wellpoint (Elevance)", header: /TOTAL CHOICE/, slide: /Total Choice/ },
  { id: "wp-plus", network: "Broad", product: "Wellpoint PLUS", carrier: "Wellpoint (Elevance)", header: /WELLPOINT PLUS/, slide: /Wellpoint Plus/i },
  { id: "hp-explorer", network: "Broad", product: "Harvard Pilgrim Explorer", carrier: "Harvard Pilgrim Health Care", header: /EXPLORER/, slide: /Explorer/ },
  { id: "mgb-complete", network: "Broad", product: "MGB Health Plan Complete HMO", carrier: "Mass General Brigham Health Plan", header: /COMPLETE/, slide: /MGB Complete|Complete HMO/ },
  { id: "hp-quality", network: "Limited", product: "Harvard Pilgrim Quality", carrier: "Harvard Pilgrim Health Care", header: /PILGRIM QUALITY/, slide: /Quality/ },
  { id: "wp-community-choice", network: "Limited", product: "Wellpoint Community Choice", carrier: "Wellpoint (Elevance)", header: /COMMUNITY CHOICE/, slide: /Community/ },
  { id: "hne", network: "Regional", product: "Health New England HMO", carrier: "Health New England", header: /HEALTH NEW ENGLAND/, slide: /Health New England/ },
];

const ROWS: Array<{ key: string; label: string; start: RegExp }> = [
  { key: "type", label: "Plan type", start: /^PLAN TYPE/ },
  { key: "pcpRequired", label: "PCP required", start: /^PCP Designation/ },
  { key: "referral", label: "Referral to specialists", start: /^PCP Referral/ },
  { key: "oopInd", label: "Out-of-pocket max (individual)", start: /^Individual coverage/ },
  { key: "oopFam", label: "Out-of-pocket max (family)", start: /^Family coverage/ },
  { key: "deductible", label: "Deductible (individual / family)", start: /^Individual \/ Family/ },
  { key: "pcp", label: "Primary care visit", start: /^Primary Care Provider/ },
  { key: "_skip", label: "", start: /^Preventive/ },
  { key: "specialist", label: "Specialist visit (tier 1/2/3)", start: /^Specialist/ },
  { key: "urgent", label: "Urgent care / retail clinic", start: /^Retail Clinic/ },
  { key: "behavioral", label: "Outpatient behavioral health", start: /^Outpatient Behavioral/ },
  { key: "er", label: "Emergency room", start: /^Emergency Room/ },
  { key: "inpatient", label: "Inpatient admission (tier 1/2/3)", start: /^Inpatient Hospital/ },
  { key: "_skip", label: "", start: /^Outpatient Surgery|^Eye & GI/ },
  { key: "surgery", label: "Outpatient surgery (hospital)", start: /^All other in Massachusetts/ },
  { key: "imaging", label: "High-tech imaging", start: /^High-Tech Imaging/ },
  { key: "rx", label: "Retail Rx (tier 1/2/3, 30 days)", start: /^Retail \(up to/ },
  { key: "mail", label: "Mail-order Rx (90 days)", start: /^Mail Order/ },
  { key: "_end", label: "", start: /^If you participate|^If you receive/ },
];
export const DESIGN_LABELS = Object.fromEntries(ROWS.filter((r) => !r.key.startsWith("_")).map((r) => [r.key, r.label]));
const NOISE = /Maximum one copay|Waived if|Contact the carrier|Prescription Drug Deductible|\(no tiering\)|no tiering|^\(e\.g\.|^Medical$|^Tier 1 \/ Tier 2/;

const text = (pdf: string) => execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
const money = (s: string) => Number(s.replace(/[$,]/g, ""));

/** Tokens of a layout line with their start column (split on 2+ spaces). */
function tokens(line: string) {
  const out: Array<{ at: number; t: string }> = [];
  for (const m of line.matchAll(/\S+(?: \S+)*/g)) out.push({ at: m.index!, t: m[0] });
  return out;
}

const TYPE_LINE = /^(HMO|PPO|POS|PPO-TYPE|INDEMNITY|EPO)$/;

export function parseDesigns(guide: string): Record<string, Record<string, string>> {
  const lines = guide.split("\n");
  const out: Record<string, Record<string, string>> = Object.fromEntries(GIC_PLANS.map((p) => [p.id, {}]));
  const starts = lines.flatMap((l, i) => (/Benefits-at-a-Glance \(Employees/.test(l) ? [i] : []));
  if (!starts.length) throw new Error("Benefits-at-a-Glance table not found");
  // The keys of each line holding values on a labelled page, in order: unlabelled facing pages follow the same sequence.
  let sequence: string[] = [];
  for (const start of starts) {
    // Header: carrier line ("HARVARD PILGRIM  WELLPOINT …") over product line ("ACCESS AMERICA  TOTAL CHOICE …"); pair tokens by position.
    const h = lines.slice(start + 1, start + 10).findIndex((l) => /(HARVARD PILGRIM|WELLPOINT|MASS GENERAL|HEALTH NEW)/.test(l)) + start + 1;
    if (h <= start) continue;
    const labelled = /^HEALTH INSURANCE/.test(lines[h]);
    const top = tokens(lines[h]).filter((t) => !/^HEALTH INSURANCE$/.test(t.t));
    const sub = tokens(lines[h + 1]).filter((t) => !/^PLANS$/.test(t.t));
    const cols = top.map((t) => {
      const mid = t.at + t.t.length / 2;
      const below = sub.reduce((b, x) => (Math.abs(x.at + x.t.length / 2 - mid) < Math.abs(b.at + b.t.length / 2 - mid) ? x : b), sub[0]);
      const name = `${t.t} ${below?.t ?? ""}`.replace(/\s+/g, " ");
      return { mid: (mid + (below ? below.at + below.t.length / 2 : mid)) / 2, plan: GIC_PLANS.find((p) => p.header.test(name)) };
    }).filter((c): c is { mid: number; plan: (typeof GIC_PLANS)[number] } => !!c.plan);
    if (!cols.length) continue;
    const labelEdge = labelled ? Math.min(...cols.map((c) => c.mid)) - 14 : 0;
    const seq: string[] = [];
    let key: string | null = null;
    let j = 0;
    let started = false;
    for (let i = h + 2; i < lines.length; i++) {
      const line = lines[i];
      if (/Benefits-at-a-Glance/.test(line) || /^\s*\d+\s*$/.test(line) && started && !labelled && j >= sequence.length) break;
      const left = labelled ? line.slice(0, Math.max(0, labelEdge)).trim() : "";
      const row = left ? ROWS.find((r) => r.start.test(left)) : undefined;
      if (row) { if (row.key === "_end") break; key = row.key; }
      const vals = tokens(line).filter((tk) => tk.at >= labelEdge && !NOISE.test(tk.t) && Math.abs(cols.reduce((b, c) => (Math.abs(c.mid - tk.at - tk.t.length / 2) < Math.abs(b.mid - tk.at - tk.t.length / 2) ? c : b), cols[0]).mid - tk.at - tk.t.length / 2) <= 40);
      if (!labelled) {
        if (!started) { if (vals.length && vals.every((v) => TYPE_LINE.test(v.t))) started = true; else continue; }
        if (!vals.length) continue;
        if (j >= sequence.length) break;
        key = sequence[j++];
      } else if (vals.length && key) seq.push(key);
      if (!key || key.startsWith("_")) continue;
      for (const tk of vals) {
        const mid = tk.at + tk.t.length / 2;
        const col = cols.reduce((b, c) => (Math.abs(c.mid - mid) < Math.abs(b.mid - mid) ? c : b), cols[0]);
        const cell = out[col.plan.id];
        cell[key] = cell[key] ? `${cell[key]} ${tk.t}` : tk.t;
      }
    }
    if (labelled) sequence = seq;
  }
  for (const d of Object.values(out)) for (const k of Object.keys(d)) d[k] = d[k].replace(/\s+/g, " ").replace(/ \/ visit/g, "").replace(/\/ visit$/, "").trim();
  return out;
}

export function parseRates(slides: string): Record<string, { network: string; individual: Tier; family: Tier }> {
  const lines = slides.split("\n");
  const at = lines.findIndex((l) => /full Cost Premiums: Non-Medicare/i.test(l));
  if (at < 0) throw new Error("Non-Medicare full-cost premium table not found");
  const out: Record<string, { network: string; individual: Tier; family: Tier }> = {};
  let network = "";
  let lastPlan: (typeof GIC_PLANS)[number] | undefined;
  for (let i = at; i < Math.min(lines.length, at + 70); i++) {
    const l = lines[i];
    const net = /^\s*(Regional|Narrow|Limited|Broad|National)\b/.exec(l)?.[1];
    if (net) network = net;
    const m = /(Individual|Family)\s+\$([\d,.]+)\s+(?:([\d,]+)\s+)?\$([\d,.]+)\s+(-?[\d.]+)%/.exec(l);
    if (!m) continue;
    // Individual rows: the plan name is on this line, else the next or previous one (names wrap). Family rows follow their plan's individual row.
    const find = (s: string | undefined) => (s ? GIC_PLANS.find((p) => p.slide.test(s.replace(/\s+/g, " "))) : undefined);
    const plan = m[1] === "Family" ? lastPlan : find(l.replace(/\$.*/, "")) ?? find(lines[i + 1]) ?? find(lines[i - 1]);
    if (!plan) throw new Error(`Can't tell which plan this premium row is for: ${l.trim()}`);
    lastPlan = plan;
    const prev = out[plan.id] ?? { network, individual: { prior: null, current: null, change: null, enrollment: null }, family: { prior: null, current: null, change: null, enrollment: null } };
    if (/^\s*(Regional|Narrow|Broad|National)\b/.test(lines[i + 1] ?? "") && !net) prev.network ||= network;
    prev[m[1] === "Individual" ? "individual" : "family"] = { prior: money(m[2]), enrollment: m[3] ? money(m[3]) : null, current: money(m[4]), change: Number(m[5]) / 100 };
    out[plan.id] = prev;
  }
  return out;
}

/** Where each year's rate vote was published (the meeting moves between February and March). */
const GUIDES: Record<string, string> = {
  "2026": "https://www.mass.gov/doc/2025-2026-state-employees-retirees-survivors-benefits-guide/download",
  "2027": "https://www.mass.gov/doc/2026-2027-state-employees-retirees-survivors-benefit-guide/download",
};
const SLIDES: Record<string, string> = {
  "2026": "https://www.mass.gov/doc/february-2025-commission-meeting-presentation/download",
  "2027": "https://www.mass.gov/doc/march-2026-commission-meeting-slides/download",
};

function main() {
  const [fy, guidePdf, slidesPdf] = process.argv.slice(2);
  if (!fy || !guidePdf || !slidesPdf) throw new Error("usage: build-gic.ts <fiscalYear> <guide.pdf> <slides.pdf>");
  const guide = text(guidePdf);
  for (const n of ["NATIONAL NETWORK", "BROAD NETWORK", "LIMITED NETWORK", "REGIONAL NETWORK"]) if (!guide.includes(n)) throw new Error(`Guide no longer has "${n}" — check plan networks in GIC_PLANS`);
  const designs = parseDesigns(guide);
  const slides = text(slidesPdf);
  const rates = parseRates(slides);
  const avg = /average Fiscal Year \d{4} premium increase amongst Non-Medicare products is ([\d.]+)%/i.exec(slides.replace(/\s+/g, " "))?.[1];
  const plans: GicPlan[] = GIC_PLANS.map((p) => {
    const r = rates[p.id];
    if (!r) throw new Error(`No premium row for ${p.product}`);
    return { id: p.id, name: p.product, product: p.product, carrier: p.carrier, network: p.network, type: designs[p.id].type ?? "", design: designs[p.id], premium: { individual: r.individual, family: r.family } };
  });
  for (const p of plans) for (const t of ["individual", "family"] as const) if (p.premium[t].current == null || p.premium[t].prior == null) throw new Error(`${p.product}: no ${t} premium`);
  for (const p of plans) for (const k of ["deductible", "oopInd", "pcp", "specialist", "er", "rx"]) if (!p.design[k]) throw new Error(`${p.product}: no ${k} parsed`);
  const out = {
    fiscalYear: Number(fy), effective: `${Number(fy) - 1}-07-01`, nonMedicareAvgIncrease: avg ? Number(avg) / 100 : null,
    note: "Full monthly cost per subscriber (employer + employee share), state plans; municipal full cost adds a 0.25% administrative fee. Enrollment is GIC's projection for open enrollment, in subscribers.",
    sources: [
      { label: `GIC ${Number(fy) - 1}–${fy} state employees' benefit guide`, url: GUIDES[fy] ?? "https://www.mass.gov/lists/benefit-guides" },
      { label: `GIC commission meeting, FY${fy} rate vote`, url: SLIDES[fy] ?? "https://www.mass.gov/orgs/group-insurance-commission" },
    ],
    labels: DESIGN_LABELS,
    plans,
  };
  const dir = join(process.cwd(), "data", "gic");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `gic-fy${fy}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote data/gic/gic-fy${fy}.json: ${plans.length} plans`);
}

if (process.argv[1]?.endsWith("build-gic.ts")) main();
