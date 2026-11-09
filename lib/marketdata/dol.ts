import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { download, eachCsv } from "./import";

/**
 * DOL Form 5500 employer health plans → carrier → broker.
 *  - F_5500: plan sponsor, EIN, location, industry (NAICS), participants, funding arrangement
 *  - Schedule A: each insurance contract — carrier, persons covered, premium, claims, commissions, policy dates
 *  - Schedule A Part 1: brokers/agents paid on each contract
 * Only welfare plans offering health benefits (code 4A) sponsored in DOL_STATES are kept.
 * Limits: plans under 100 participants mostly file the short form (no Schedule A); self-funded plans
 * usually don't name their administrator, so their carrier is often unknown.
 */

export const dolStates = () =>
  new Set((process.env.DOL_STATES ?? "MA,NH,ME,RI,CT,VT").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));

/** Carriers that file "health" Schedule As for non-major-medical products (dental, disability, hospital indemnity…). */
export const NON_MAJOR_MEDICAL = /dental|vision|\bvsp\b|eyemed|metropolitan life|metlife|guardian|\bunum\b|lincoln|principal life|aflac|voya|mutual of omaha|colonial life|standard insurance|reliance standard|hartford|prudential|transamerica|allstate|new york life|securian|minnesota life|sun life/i;

const n = (v: string | undefined) => {
  const x = Number((v ?? "").replace(/[$,]/g, ""));
  return v && v.trim() !== "" && Number.isFinite(x) ? x : null;
};
const d = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T00:00:00Z`) : null);
const flag = (v: string | undefined) => v === "1" || v === "Y";
const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

type PlanRow = Omit<Prisma.EmployerPlanCreateManyInput, "funding" | "id"> & { benefitAssets: boolean };
type Contract = Omit<Prisma.EmployerContractCreateManyInput, "planId" | "id"> & { ackId: string; key: string };

/**
 * insured     — premium-bearing health contracts cover (most of) the plan
 * mixed       — some insured contracts (e.g. regional HMOs) but most participants self-funded
 * self-funded — benefits paid from employer assets/trust, stop-loss, or health schedules with no premium (ASO-style)
 */
export function fundingFor(
  plan: { benefitAssets: boolean; participants?: number | null },
  health: Array<{ premium?: number | null; personsCovered?: number | null }>,
  hasStopLoss: boolean,
): string {
  const insuredContracts = health.filter((c) => (c.premium ?? 0) > 0);
  const insured = insuredContracts.length > 0;
  const selfSignals = plan.benefitAssets || hasStopLoss || (health.length > 0 && !insured);
  if (!insured) return selfSignals ? "self-funded" : "unknown";
  if (!selfSignals) return "insured";
  const insuredPersons = insuredContracts.reduce((s, c) => s + (c.personsCovered ?? 0), 0);
  const covered = plan.participants ? insuredPersons / plan.participants : 1;
  return hasStopLoss || covered < 0.5 ? "mixed" : "insured";
}

export async function importDol(year: number, mainUrl: string, dir: string): Promise<number> {
  const states = dolStates();
  const schAUrl = mainUrl.replace(/F_5500_(\d{4})_Latest/, "F_SCH_A_$1_Latest");
  const partUrl = mainUrl.replace(/F_5500_(\d{4})_Latest/, "F_SCH_A_PART1_$1_Latest");

  // 1) Health welfare plans in scope
  const plans = new Map<string, PlanRow>();
  await eachCsv(await download(mainUrl, dir, "f5500.zip"), () => true, (_, r) => {
    if (!(r.TYPE_WELFARE_BNFT_CODE ?? "").includes("4A")) return;
    const state = clean(r.SPONS_DFE_MAIL_US_STATE || r.SPONS_DFE_LOC_US_STATE);
    if (!states.has(state)) return;
    const begin = d(r.FORM_PLAN_YEAR_BEGIN_DATE);
    if (!begin || !r.ACK_ID) return;
    plans.set(r.ACK_ID, {
      ackId: r.ACK_ID,
      formYear: year,
      ein: clean(r.SPONS_DFE_EIN),
      planNum: clean(r.SPONS_DFE_PN),
      sponsor: clean(r.SPONSOR_DFE_NAME),
      dba: clean(r.SPONS_DFE_DBA_NAME) || null,
      city: clean(r.SPONS_DFE_MAIL_US_CITY || r.SPONS_DFE_LOC_US_CITY) || null,
      state,
      zip: clean(r.SPONS_DFE_MAIL_US_ZIP || r.SPONS_DFE_LOC_US_ZIP).slice(0, 5) || null,
      naics: clean(r.BUSINESS_CODE) || null,
      planName: clean(r.PLAN_NAME),
      planYearBegin: begin,
      participants: Math.round(n(r.TOT_ACTIVE_PARTCP_CNT) ?? n(r.TOT_PARTCP_BOY_CNT) ?? 0) || null,
      receivedAt: d(r.DATE_RECEIVED),
      benefitAssets: flag(r.BENEFIT_GEN_ASSET_IND) || flag(r.BENEFIT_TRUST_IND),
    });
  }, "upper");

  // 2) Their insurance contracts (major medical + stop-loss)
  const contracts: Contract[] = [];
  await eachCsv(await download(schAUrl, dir, "scha.zip"), () => true, (_, r) => {
    if (!plans.has(r.ACK_ID)) return;
    const carrier = clean(r.INS_CARRIER_NAME);
    if (!carrier) return;
    const stopLoss = flag(r.WLFR_BNFT_STOP_LOSS_IND);
    const health = flag(r.WLFR_BNFT_HEALTH_IND) || flag(r.WLFR_BNFT_HMO_IND) || flag(r.WLFR_BNFT_PPO_IND) || flag(r.WLFR_BNFT_INDEMNITY_IND);
    let kind: string | null = null;
    if (stopLoss) kind = "stop_loss";
    else if (health && !NON_MAJOR_MEDICAL.test(carrier)) kind = "health";
    if (!kind) return;
    contracts.push({
      ackId: r.ACK_ID,
      key: `${r.ACK_ID}|${r.FORM_ID}`,
      kind,
      carrier,
      carrierNaic: clean(r.INS_CARRIER_NAIC_CODE) || null,
      contractNum: clean(r.INS_CONTRACT_NUM) || null,
      personsCovered: n(r.INS_PRSN_COVERED_EOY_CNT) === null ? null : Math.round(n(r.INS_PRSN_COVERED_EOY_CNT)!),
      premium: n(r.WLFR_TOT_EARNED_PREM_AMT) ?? n(r.WLFR_PREMIUM_RCVD_AMT),
      claims: n(r.WLFR_INCURRED_CLAIM_AMT),
      brokerComm: n(r.INS_BROKER_COMM_TOT_AMT),
      brokerFees: n(r.INS_BROKER_FEES_TOT_AMT),
      policyFrom: d(r.INS_POLICY_FROM_DATE),
      policyTo: d(r.INS_POLICY_TO_DATE),
      hmo: flag(r.WLFR_BNFT_HMO_IND),
      ppo: flag(r.WLFR_BNFT_PPO_IND),
    });
  }, "upper");

  // 3) Brokers on those contracts
  const keys = new Set(contracts.map((c) => c.key));
  const brokers = new Map<string, Array<{ name: string; city: string | null; state: string | null; commission: number | null; fees: number | null }>>();
  await eachCsv(await download(partUrl, dir, "part1.zip"), () => true, (_, r) => {
    const key = `${r.ACK_ID}|${r.FORM_ID}`;
    if (!keys.has(key)) return;
    const name = clean(r.INS_BROKER_NAME);
    if (!name) return;
    const list = brokers.get(key) ?? [];
    list.push({ name, city: clean(r.INS_BROKER_US_CITY) || null, state: clean(r.INS_BROKER_US_STATE) || null, commission: n(r.INS_BROKER_COMM_PD_AMT), fees: n(r.INS_BROKER_FEES_PD_AMT) });
    brokers.set(key, list);
  }, "upper");

  // 4) Write: replace this form year
  await db.employerPlan.deleteMany({ where: { formYear: year } });
  let written = 0;
  const all = [...plans.values()];
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500);
    await db.employerPlan.createMany({
      data: chunk.map(({ benefitAssets, ...p }) => {
        const mine = contracts.filter((c) => c.ackId === p.ackId);
        return { ...p, funding: fundingFor({ benefitAssets, participants: p.participants }, mine.filter((c) => c.kind === "health"), mine.some((c) => c.kind === "stop_loss")) };
      }),
      skipDuplicates: true,
    });
    written += chunk.length;
  }
  const ids = new Map((await db.employerPlan.findMany({ where: { formYear: year }, select: { id: true, ackId: true } })).map((p) => [p.ackId, p.id]));
  const rows = contracts
    .filter((c) => ids.has(c.ackId))
    .map(({ ackId, key, ...c }) => ({ ...c, planId: ids.get(ackId)!, brokers: (brokers.get(key) ?? undefined) as Prisma.InputJsonValue | undefined }));
  for (let i = 0; i < rows.length; i += 1000) await db.employerContract.createMany({ data: rows.slice(i, i + 1000) });
  const providers = await importScheduleC(year, mainUrl, dir);
  return written + rows.length + providers;
}

/** DOL Schedule C service codes that mean "administers the plan's claims". */
const ADMIN_CODES = new Set(["12", "13", "14"]); // claims processing, contract administrator, plan administrator
const BROKER_CODES = new Set(["22", "55"]); // insurance brokerage / agents
const ADMIN_RELATION = /\b(tpa|third party admin|administrat|claims|aso|carrier|insurer)\b/i;
const BROKER_RELATION = /\b(broker|agent|consult)/i;
/** Carrier-owned TPAs file under their own names. */
const TPA_PARENT: Array<[RegExp, string]> = [
  [/^health plans,? inc/i, "Point32Health"],
  [/\bumr\b/i, "UnitedHealthcare"],
  [/blue benefit administrators of massachusetts|blue benefit administrators of ma|blue cross (and )?blue shield of ma\b/i, "Blue Cross Blue Shield of Massachusetts"],
  [/^meritain/i, "Aetna"],
  [/^allied benefit/i, "Allied Benefit Systems"],
];
/** Administrators of something other than medical claims (dental, vision, pharmacy, spending accounts). */
export const NON_MEDICAL_ADMIN = /dental|vision|eyemed|davis vision|\bvsp\b|caremark|express scripts|optumrx|optum rx|allegiant rx|elixir|\bpbm\b|pharmac|wageworks|navia|flex|\bfsa\b|\bhsa\b|cobra|healthequity|benefit resource|\bunum\b|lincoln|hartford|matrix absence|sun life|metlife|metropolitan life|guardian/i;

/**
 * Schedule C (service providers paid from plan assets) for this form year's plans already in the database. Separate
 * from importDol so servers that imported Form 5500 before 0.13 can backfill it without re-importing everything.
 */
export async function importScheduleC(year: number, mainUrl?: string, dir?: string): Promise<number> {
  const url = (mainUrl ?? `https://askebsa.dol.gov/FOIA%20Files/${year}/Latest/F_5500_${year}_Latest.zip`);
  const itemUrl = url.replace(/F_5500_(\d{4})_Latest/, "F_SCH_C_PART1_ITEM2_$1_Latest");
  const codeUrl = url.replace(/F_5500_(\d{4})_Latest/, "F_SCH_C_PART1_ITEM2_CODES_$1_Latest");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const work = dir ?? (await mkdtemp(join(tmpdir(), "schc-")));
  try {
    const plans = new Map((await db.employerPlan.findMany({ where: { formYear: year }, select: { id: true, ackId: true } })).map((p) => [p.ackId, p.id]));
    const codes = new Map<string, string[]>();
    await eachCsv(await download(codeUrl, work, "schc-codes.zip"), () => true, (_, r) => {
      if (!plans.has(r.ACK_ID)) return;
      const k = `${r.ACK_ID}|${r.ROW_ORDER}`;
      (codes.get(k) ?? codes.set(k, []).get(k)!).push(clean(r.SERVICE_CODE));
    }, "upper");
    const { canonicalCarrier } = await import("./events");
    const out: Prisma.EmployerProviderCreateManyInput[] = [];
    await eachCsv(await download(itemUrl, work, "schc.zip"), () => true, (_, r) => {
      const planId = plans.get(r.ACK_ID);
      if (!planId) return;
      const name = clean(r.PROVIDER_OTHER_NAME);
      if (!name) return;
      const cs = codes.get(`${r.ACK_ID}|${r.ROW_ORDER}`) ?? [];
      const relation = clean(r.PROVIDER_OTHER_RELATION) || null;
      const carrier = canonicalCarrier(name.replace(/SHEILD/gi, "SHIELD")) ?? TPA_PARENT.find(([re]) => re.test(name))?.[1] ?? null;
      const admin = cs.some((c) => ADMIN_CODES.has(c)) || ADMIN_RELATION.test(relation ?? "") || (!!carrier && !cs.some((c) => BROKER_CODES.has(c)));
      const broker = !admin && (cs.some((c) => BROKER_CODES.has(c)) || BROKER_RELATION.test(relation ?? ""));
      // "administrator" = medical claims administrator; dental/vision/pharmacy/account administrators are "other".
      const role = admin && !NON_MEDICAL_ADMIN.test(name) ? "administrator" : broker ? "broker" : "other";
      out.push({ planId, name, ein: clean(r.PROVIDER_OTHER_EIN) || null, relation, codes: cs, role, carrier: NON_MEDICAL_ADMIN.test(name) ? null : carrier, directComp: n(r.PROVIDER_OTHER_DIRECT_COMP_AMT) });
    }, "upper");
    await db.employerProvider.deleteMany({ where: { plan: { formYear: year } } });
    for (let i = 0; i < out.length; i += 1000) await db.employerProvider.createMany({ data: out.slice(i, i + 1000) });
    return out.length;
  } finally {
    if (!dir) await rm(work, { recursive: true, force: true });
  }
}
