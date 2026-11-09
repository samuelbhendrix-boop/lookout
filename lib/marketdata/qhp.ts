import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { download, eachCsv } from "./import";

/**
 * Exchange plan designs from CMS's QHP public use files.
 *  - State-based Exchanges (MA, CT, RI, VT, ME): one zip per state per year, https://www.cms.gov/CCIIO/Resources/Data-Resources/sbm-puf
 *  - Federal platform (NH): national files per year, https://www.cms.gov/marketplace/resources/data/public-use-files
 * Both layouts carry the same fields under different header spellings; headers are normalised to A–Z0–9 so one
 * mapping reads both. One row is kept per plan: the standard variant (-01 on exchange, else -00), not the CSR variants.
 */

const SBE: Record<number, Record<string, string>> = {
  2024: {
    MA: "https://www.cms.gov/files/zip/massachusettssbepuf2024.zip", CT: "https://www.cms.gov/files/zip/connecticutsbepuf2024.zip",
    RI: "https://www.cms.gov/files/zip/rhodeislandsbepuf2024.zip", VT: "https://www.cms.gov/files/zip/vermontsbepuf2024.zip",
    ME: "https://www.cms.gov/files/zip/mainesbepuf2024.zip",
  },
  2025: {
    MA: "https://www.cms.gov/files/zip/massachusettssbepuf2025.zip", CT: "https://www.cms.gov/files/zip/connecticutsbepuf2025.zip",
    RI: "https://www.cms.gov/files/zip/rhodeislandsbepuf2025.zip", VT: "https://www.cms.gov/files/zip/vermontsbepuf2025.zip",
    ME: "https://www.cms.gov/files/zip/mainesbepuf2025.zip",
  },
  2026: {
    MA: "https://www.cms.gov/files/zip/massachusettssbepuf2026.zip", CT: "https://www.cms.gov/files/zip/connecticutsbepuf2026.zip",
    RI: "https://www.cms.gov/files/zip/rhodeislandsbepuf2026.zip", VT: "https://www.cms.gov/files/zip/vermontsbepuf2026.zip",
    ME: "https://www.cms.gov/files/zip/mainesbepuf2026.zip",
  },
};
/** Federal-platform New England states. */
const FFE_STATES = new Set(["NH"]);
const FFE_FILES = ["plan-attributes-puf", "benefits-and-cost-sharing-puf", "rate-puf", "service-area-puf", "network-puf"] as const;
const ffeUrl = (year: number, f: string) => `https://download.cms.gov/marketplace-puf/${year}/${f}.zip`;

export const QHP_YEARS = [2024, 2025, 2026, 2027];
/** States each plan year covers (SBE files appear mid-year; the federal files before open enrollment). */
export const qhpCoverage = (year: number) => [...Object.keys(SBE[year] ?? {}), ...FFE_STATES];

const norm = (h: string) => h.replace(/^﻿|^ï»¿/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** "$2,000 " → 2000; "$2000 per person | $4000 per group" → per group (family); "Not Applicable" → null. */
export function money(s: string | undefined, family = false): number | null {
  if (!s) return null;
  const t = s.trim();
  if (!t || /not applicable|^n\/?a$/i.test(t)) return null;
  if (family) {
    const g = /\$?([\d,.]+)\s*per group/i.exec(t);
    if (g) return Number(g[1].replace(/,/g, ""));
    if (/per group not applicable/i.test(t)) return null;
  }
  const m = /\$?\s*([\d,]+(?:\.\d+)?)/.exec(t);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}
export function pct(s: string | undefined): number | null {
  const m = /([\d.]+)\s*%/.exec(s ?? "");
  return m ? Number(m[1]) / 100 : null;
}
const yes = (s: string | undefined) => /^(yes|true|y|covered)$/i.test((s ?? "").trim());
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

/** Benefit names whose cost sharing is shown for federal-platform plans (SBE files don't carry copays). */
const COST_SHARE: Record<string, string> = {
  "PRIMARY CARE VISIT TO TREAT AN INJURY OR ILLNESS": "pcp",
  "SPECIALIST VISIT": "specialist",
  "EMERGENCY ROOM SERVICES": "er",
  "URGENT CARE CENTERS OR FACILITIES": "urgent",
  "GENERIC DRUGS": "generic",
  "PREFERRED BRAND DRUGS": "brand",
  "SPECIALTY DRUGS": "specialty",
  "INPATIENT HOSPITAL SERVICES (E.G., HOSPITAL STAY)": "inpatient",
  "OUTPATIENT SURGERY PHYSICIAN/SURGICAL SERVICES": "surgery",
  "IMAGING (CT/PET SCANS, MRIS)": "imaging",
};
/** "$25.00 Copay after deductible" + "0.00%" → "$25 after ded." — short text for a table cell. */
function shareText(copay: string | undefined, coins: string | undefined) {
  const c = (copay ?? "").trim(), i = (coins ?? "").trim();
  const ded = /after deductible/i.test(c + i);
  const cp = money(c);
  const co = pct(i);
  const parts: string[] = [];
  if (cp && cp > 0) parts.push(`$${Math.round(cp)}`);
  if (co && co > 0) parts.push(`${Math.round(co * 100)}%`);
  if (!parts.length) {
    if (/no charge/i.test(c + i) || cp === 0 || co === 0) parts.push(ded ? "$0" : "No charge");
    else if (!c && !i) return null;
    else parts.push((c || i).slice(0, 24));
  }
  return `${parts.join(" + ")}${ded ? " after ded." : ""}`;
}

type Acc = {
  plans: Map<string, Prisma.QhpPlanCreateManyInput & { _variant: string }>;
  covered: Map<string, Set<string>>;
  share: Map<string, Record<string, string>>;
  prem: Map<string, Map<string, { a21?: number; a40?: number; a60?: number }>>;
  networks: Map<string, string>;
  areas: Map<string, { statewide: boolean; counties: Set<string> }>;
};

/** The standard variant of a plan: -01 on exchange beats -00 off exchange; CSR variants (-02…-06) are skipped. */
const variantRank = (v: string) => (v === "01" ? 2 : v === "00" ? 1 : 0);

function planRow(r: Record<string, string>, year: number, state: string, acc: Acc, source: string) {
  if (yes(r.DENTALONLYPLAN)) return;
  const fullId = r.PLANID ?? "";
  const [planId, variant = "00"] = fullId.split("-");
  if (!planId || variantRank(variant) === 0) return;
  const cur = acc.plans.get(planId);
  if (cur && variantRank(cur._variant) >= variantRank(variant)) return;
  const integrated = yes(r.MEDICALDRUGDEDUCTIBLESINTEGRATED);
  // Integrated plans file one medical+drug deductible (TEHB); others file medical (MEHB) and drug (DEHB) separately.
  const ded = (fam: boolean) => {
    const t = fam ? (r.TEHBDEDINNTIER1FAMILYPERGROUP ?? r.TEHBDEDINNTIER1FAMILY) : r.TEHBDEDINNTIER1INDIVIDUAL;
    const m = fam ? (r.MEHBDEDINNTIER1FAMILYPERGROUP ?? r.MEHBDEDINNTIER1FAMILY) : r.MEHBDEDINNTIER1INDIVIDUAL;
    return money(t, fam) ?? money(m, fam);
  };
  const moop = (fam: boolean) => {
    const t = fam ? (r.TEHBINNTIER1FAMILYPERGROUPMOOP ?? r.TEHBINNTIER1FAMILYMOOP) : r.TEHBINNTIER1INDIVIDUALMOOP;
    const m = fam ? (r.MEHBINNTIER1FAMILYPERGROUPMOOP ?? r.MEHBINNTIER1FAMILYMOOP) : r.MEHBINNTIER1INDIVIDUALMOOP;
    return money(t, fam) ?? money(m, fam);
  };
  const sbc = (k: string) => {
    const parts = ["DEDUCTIBLE", "COPAYMENT", "COINSURANCE", "LIMIT"].map((p) => money(r[`SBCHAVING${k}${p}`]));
    return parts.every((p) => p == null) ? null : parts.reduce<number>((s, p) => s + (p ?? 0), 0);
  };
  const av = pct(r.ISSUERACTUARIALVALUE) ?? (Number(r.AVCALCULATOROUTPUTNUMBER) > 0 && Number(r.AVCALCULATOROUTPUTNUMBER) < 1 ? Number(r.AVCALCULATOROUTPUTNUMBER) : null);
  const oon = [r.TEHBOUTOFNETINDIVIDUALMOOP, r.MEHBOUTOFNETINDIVIDUALMOOP, r.TEHBDEDOUTOFNETINDIVIDUAL, r.MEHBDEDOUTOFNETINDIVIDUAL].some((x) => money(x) != null);
  const design = `${r.PLANDESIGNTYPE ?? ""} ${r.DESIGNTYPE ?? ""}`;
  acc.plans.set(planId, {
    _variant: variant,
    id: `${year}:${planId}`, year, state, issuerId: r.ISSUERID, issuerName: r.ISSUERMARKETPLACEMARKETINGNAME || r.ISSUERNAME || null,
    market: /shop|small/i.test(r.MARKETCOVERAGE) ? "SHOP" : "Individual",
    planId, productId: r.HIOSPRODUCTID || planId.slice(0, 10), name: (r.PLANMARKETINGNAME || r.PLANVARIANTMARKETINGNAME || planId).trim(),
    metal: r.METALLEVEL || null, planType: r.PLANTYPE || null, networkId: r.NETWORKID || null, serviceAreaId: r.SERVICEAREAID || null,
    isNew: /^new/i.test(r.ISITANEWPLAN ?? r.ISNEWPLAN ?? ""),
    // Standardized designs: state-mandated (MA, CT, ME, VT name them "Standard …") or federal standardized options
    // (DesignType "Design 1…"). "Non-Standard …" plans are issuer-designed.
    // Maine's standardized plans are branded "Clear Choice".
    standardized: /design\s*\d/i.test(design) || (/\bstandard\b|clear choice/i.test(r.PLANMARKETINGNAME ?? "") && !/non[\s-]?standard/i.test(r.PLANMARKETINGNAME ?? "")),
    hsa: yes(r.ISHSAELIGIBLE), nationalNetwork: yes(r.NATIONALNETWORK), referral: yes(r.ISREFERRALREQUIREDFORSPECIALIST),
    tiered: yes(r.MULTIPLENETWORKTIERS ?? r.MULTIPLEINNETWORKTIERS), outOfNetwork: oon, wellness: yes(r.WELLNESSPROGRAMOFFERED),
    diseaseMgmt: r.DISEASEMANAGEMENTPROGRAMSOFFERED?.trim() || null,
    av: av != null && av > 0.4 && av < 1 ? av : null,
    dedInd: ded(false), dedFam: ded(true),
    drugDed: integrated ? null : money(r.DEHBDEDINNTIER1INDIVIDUAL),
    moopInd: moop(false), moopFam: moop(true),
    coinsurance: pct(r.TEHBDEDINNTIER1COINSURANCE) ?? pct(r.MEHBDEDINNTIER1COINSURANCE ?? r.MEHBDEDINNTIER1COINSURNACE),
    sbcBaby: sbc("ABABY"), sbcDiabetes: sbc("DIABETES"), sbcFracture: sbc("SIMPLEFRACTURE"),
    covered: [], sbcUrl: r.URLFORSUMMARYOFBENEFITSCOVERAGE || null, source,
  });
}

/** Import one plan year for every New England state CMS publishes; replaces that year's rows. */
export async function importQhp(year: number): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "qhp-"));
  let total = 0;
  try {
    const states = qhpCoverage(year);
    // SBE: one small zip per state, all six tables inside.
    for (const st of Object.keys(SBE[year] ?? {})) {
      const zip = await download(SBE[year][st], dir, `${st}.zip`);
      const acc: Acc = { plans: new Map(), covered: new Map(), share: new Map(), prem: new Map(), networks: new Map(), areas: new Map() };
      // Plans first (so later tables can be filtered to known plans), then the rest in one pass.
      await eachCsv(zip, isPlansFile, (_n, row) => planRow(normRow(row), year, st, acc, "SBE QHP PUF"), "upper");
      await eachCsv(zip, (n) => !isPlansFile(n), (n, row) => tableRow(n, normRow(row), st, acc), "upper");
      total += await save(year, st, acc);
    }
    // Federal platform: national files, filtered to New England's FFE states while streaming.
    if (states.some((s) => FFE_STATES.has(s))) {
      const accs = new Map<string, Acc>();
      const accFor = (st: string) => accs.get(st) ?? accs.set(st, { plans: new Map(), covered: new Map(), share: new Map(), prem: new Map(), networks: new Map(), areas: new Map() }).get(st)!;
      for (const f of FFE_FILES) {
        let zip: string;
        try { zip = await download(ffeUrl(year, f), dir, `${f}.zip`); } catch (e) {
          if (f === "plan-attributes-puf") throw e;
          continue; // a missing secondary table only drops those fields
        }
        await eachCsv(zip, () => true, (_n, row) => {
          const r = normRow(row);
          if (!FFE_STATES.has(r.STATECODE)) return;
          if (f === "plan-attributes-puf") planRow(r, year, r.STATECODE, accFor(r.STATECODE), "Exchange PUF");
          else tableRow(f, r, r.STATECODE, accFor(r.STATECODE));
        }, "upper");
        await rm(zip, { force: true }); // national files are large; keep the temp dir small
      }
      for (const [st, acc] of accs) total += await save(year, st, acc);
    }
    return total;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const isPlansFile = (n: string) => /plan/i.test(n) && !/rate|benefit|network|service|business|crosswalk|dictionary/i.test(n);

function normRow(row: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) out[norm(k)] = typeof v === "string" ? v : String(v ?? "");
  return out;
}

function tableRow(file: string, r: Record<string, string>, state: string, acc: Acc) {
  const f = file.toLowerCase();
  if (/benefit/.test(f)) {
    const [planId, variant = "00"] = (r.PLANID ?? "").split("-");
    if (variantRank(variant) === 0) return;
    const name = (r.BENEFITNAME ?? "").trim();
    if (!name) return;
    if (/^(yes|covered)$/i.test((r.ISCOVERED ?? "").trim())) (acc.covered.get(planId) ?? acc.covered.set(planId, new Set()).get(planId)!).add(name);
    const key = COST_SHARE[name.toUpperCase()];
    if (key && (r.COPAYINNTIER1 || r.COINSINNTIER1)) {
      const t = shareText(r.COPAYINNTIER1, r.COINSINNTIER1);
      if (t) (acc.share.get(planId) ?? acc.share.set(planId, {}).get(planId)!)[key] = t;
    }
  } else if (/rate/.test(f)) {
    const planId = (r.PLANID ?? "").split("-")[0];
    const age = (r.AGE ?? "").trim();
    // Vermont is community-rated: one rate per plan with no age ("Family Option"), the same at every age.
    const community = !age || /family/i.test(age);
    const want = age === "21" ? "a21" : age === "40" ? "a40" : age === "60" ? "a60" : null;
    if ((!want && !community) || /^tobacco user$/i.test(r.TOBACCO ?? "")) return;
    const v = Number(r.INDIVIDUALRATE);
    if (!(v > 0) || v > 20000) return; // 9999 placeholders
    const area = (r.RATINGAREAID ?? "").trim();
    const m = acc.prem.get(planId) ?? acc.prem.set(planId, new Map()).get(planId)!;
    const x = m.get(area) ?? {};
    if (community) { x.a21 = v; x.a40 = v; x.a60 = v; } else x[want!] = v;
    m.set(area, x);
  } else if (/network/.test(f)) {
    if (r.NETWORKID && r.NETWORKNAME) acc.networks.set(`${r.ISSUERID}:${r.NETWORKID}`, r.NETWORKNAME.trim());
  } else if (/service/.test(f)) {
    if (!r.SERVICEAREAID) return;
    const k = `${r.ISSUERID}:${r.SERVICEAREAID}`;
    const a = acc.areas.get(k) ?? acc.areas.set(k, { statewide: false, counties: new Set() }).get(k)!;
    if (yes(r.COVERENTIRESTATE)) a.statewide = true;
    const county = (r.COUNTYNAME || r.COUNTY || "").trim();
    if (county) a.counties.add(county.replace(/\s*-\s*\d+$/, ""));
  }
}

async function save(year: number, state: string, acc: Acc): Promise<number> {
  // SBE files leave the issuer name blank; take the legal entity name from the same issuer's rate filings.
  const filed = await db.rateFiling.findMany({ where: { state }, select: { hiosId: true, company: true, planYear: true }, orderBy: { planYear: "desc" } });
  const nameOf = new Map<string, string>();
  for (const f of filed) if (!nameOf.has(f.hiosId)) nameOf.set(f.hiosId, f.company);
  const rows: Prisma.QhpPlanCreateManyInput[] = [];
  for (const p of acc.plans.values()) {
    const { _variant, ...plan } = p;
    void _variant;
    const prem = acc.prem.get(plan.planId);
    const areas = prem ? [...prem.entries()] : [];
    const p40 = areas.map(([, x]) => x.a40).filter((x): x is number => x != null);
    const area = plan.serviceAreaId ? acc.areas.get(`${plan.issuerId}:${plan.serviceAreaId}`) : undefined;
    rows.push({
      ...plan,
      issuerName: nameOf.get(plan.issuerId) ?? plan.issuerName ?? null,
      networkName: plan.networkId ? acc.networks.get(`${plan.issuerId}:${plan.networkId}`) ?? null : null,
      statewide: area?.statewide ?? false, counties: area ? (area.statewide ? null : area.counties.size) : null,
      covered: [...(acc.covered.get(plan.planId) ?? [])].sort(),
      costShare: acc.share.get(plan.planId) ?? undefined,
      prem21: median(areas.map(([, x]) => x.a21).filter((x): x is number => x != null)),
      prem40: median(p40), prem60: median(areas.map(([, x]) => x.a60).filter((x): x is number => x != null)),
      prem40Min: p40.length ? Math.min(...p40) : null, prem40Max: p40.length ? Math.max(...p40) : null,
      areaPrem40: areas.length ? Object.fromEntries(areas.filter(([, x]) => x.a40 != null).map(([a, x]) => [a, x.a40!])) : undefined,
    });
  }
  await db.$transaction(async (tx) => {
    await tx.qhpPlan.deleteMany({ where: { year, state } });
    for (let i = 0; i < rows.length; i += 500) await tx.qhpPlan.createMany({ data: rows.slice(i, i + 500) });
  }, { timeout: 120_000 });
  return rows.length;
}
