import reference from "../../../data/medicare/reference.json";
import tinMap from "../../../data/medicare/hospital-tins.json";
import irs from "../../../data/irs/ne-health-orgs.json";
import npiNames from "../../../data/npi/names.json";

/**
 * Medicare's price for a benchmark service — the industry yardstick for commercial rates ("% of Medicare").
 * Built from CMS fee schedules by scripts/build-medicare-reference.ts. Every result carries the method used, and null
 * results carry the reason, so the UI can say exactly what wasn't compared.
 */
type Hospital = { name: string; state: string; wageIndex: number; gaf: number; tchop: number; tchcp: number; dshopp: number; dshcpp: number; ucpPerClaim: number; vbp: number; readm: number };
type Ref = typeof reference;
const R = reference as Ref & { hospitals: Record<string, Hospital> };
const PFS = R.pfs.codes as Record<string, { status: string; work: number; peNonFac: number | null; peFac: number; mp: number }>;
const OPPS = R.opps.codes as Record<string, { si: string; apc: string | null; rate: number | null }>;
const CLFS = R.clfs as Record<string, number>;
const WEIGHTS = R.ipps.weights as Record<string, number>;
const APR = R.aprCrosswalk as Record<string, string[]>;
// Reviewed matches win; auto matches (scripts/match-hospitals.ts, strict rules) fill in the rest.
const TIN_CCN = { ...((tinMap as { auto?: Record<string, string> }).auto ?? {}), ...(tinMap.map as Record<string, string>) };
const IRS = irs.orgs as unknown as Record<string, [string, string, string]>;
const NPI = npiNames.npis as unknown as Record<string, [string, string]>;
/** Name for providers whose rate files omit it: IRS exempt-org register (TINs) or NPPES registry (NPI-keyed rows). */
export const irsName = (tin: string) => (tin.startsWith("npi:") ? NPI[tin.slice(4)]?.[0] : IRS[tin]?.[0]) ?? (TIN_CCN[tin] ? R.hospitals[TIN_CCN[tin]]?.name : null) ?? null;
const EXEMPT = tinMap.exempt as Record<string, string>;
const OFFICE_EM = new Set(["99203", "99204", "99213", "99214"]);
const OPPS_PAID = new Set(["J1", "J2", "T", "S", "Q1", "Q2", "Q3", "V"]);

export type MedicareRef = { amount: number; method: string; hospital?: string } | { amount: null; reason: string };
export const MEDICARE_SOURCES = R.sources;
export const MEDICARE_GENERATED = R.generated;

const EIN_STATE: Record<string, string> = { "01": "ME", "02": "NH", "03": "VT", "04": "MA", "05": "RI", "06": "CT" };
const STATE_AVG = (R as unknown as { stateAverages: Record<string, { wageIndex: number; gaf: number }> }).stateAverages;
const GPCI = R.pfs.gpci as Array<{ state: string; locality: string; work: number; pe: number; mp: number }>;

/** Provider state: the matched Medicare hospital's state, else the IRS exempt-org register, else the EIN's IRS campus prefix (01–06 are New England), else null. */
export function providerState(tin: string): string | null {
  const ccn = TIN_CCN[tin];
  if (ccn && R.hospitals[ccn]) return R.hospitals[ccn].state;
  if (IRS[tin]) return IRS[tin][1];
  if (tin.startsWith("npi:")) return NPI[tin.slice(4)]?.[1] || null;
  return /^\d{9}$/.test(tin) ? EIN_STATE[tin.slice(0, 2)] ?? null : null;
}

export function hospitalFor(tin: string): { ccn: string; h: Hospital } | { exempt: string } | null {
  if (EXEMPT[tin]) return { exempt: EXEMPT[tin] };
  const ccn = TIN_CCN[tin];
  return ccn && R.hospitals[ccn] ? { ccn, h: R.hospitals[ccn] } : null;
}

/** Physician fee schedule in the provider's state (localities averaged where a state has several; MA if unknown). */
function pfsAmount(code: string, state = "MA"): number | null {
  const p = PFS[code];
  if (!p || !["A", "R", "T"].includes(p.status)) return null;
  const pe = p.peNonFac ?? p.peFac;
  const locs = GPCI.filter((g) => g.state === state);
  const per = (locs.length ? locs : GPCI.filter((g) => g.state === "MA")).map((g) => (p.work * g.work + pe * g.pe + p.mp * g.mp) * R.pfs.conversionFactor);
  const v = per.reduce((s, x) => s + x, 0) / per.length;
  return v > 0 ? v : null;
}

function ippsAmount(weight: number, h: Hospital | null, state: string): number {
  const avg = STATE_AVG[state] ?? R.massachusettsAverage;
  const wi = h?.wageIndex ?? avg.wageIndex;
  const gaf = h?.gaf ?? avg.gaf;
  const base = wi > 1 ? R.ipps.laborHigh * wi + R.ipps.nonlaborHigh : R.ipps.laborLow * wi + R.ipps.nonlaborLow;
  const operating = base * weight * (1 + (h?.tchop ?? 0) + (h?.dshopp ?? 0)) * (h?.vbp ?? 1) * (h?.readm ?? 1) + (h?.ucpPerClaim ?? 0);
  const capital = R.ipps.capital * gaf * weight * (1 + (h?.tchcp ?? 0) + (h?.dshcpp ?? 0));
  return operating + capital;
}

/**
 * Medicare amount for (code, billing class) at a provider. With a TIN that maps to a Medicare hospital, inpatient and
 * outpatient-facility amounts use that hospital's own wage index and teaching/DSH add-ons; otherwise statewide averages.
 */
export function medicareFor(codeType: string, code: string, billingClass: string, tin?: string, defaultState = "MA"): MedicareRef {
  const hosp = tin ? hospitalFor(tin) : null;
  const h = hosp && "h" in hosp ? hosp.h : null;
  const known = tin ? providerState(tin) : defaultState;
  const state = known || defaultState;
  const stateName = known ? state : `${state} (provider state unknown)`;

  if (codeType === "MS-DRG" || codeType === "APR-DRG") {
    if (billingClass !== "institutional") return { amount: null, reason: "DRGs are facility payments" };
    if (hosp && "exempt" in hosp) return { amount: null, reason: hosp.exempt };
    const drgs = codeType === "MS-DRG" ? [code] : APR[code];
    if (!drgs?.length) return { amount: null, reason: "No MS-DRG crosswalk for this APR-DRG" };
    const ws = drgs.map((d) => WEIGHTS[d]).filter((w): w is number => !!w);
    if (!ws.length) return { amount: null, reason: `MS-DRG ${code} has no FY2027 weight (retired)` };
    const w = ws.reduce((s, x) => s + x, 0) / ws.length;
    const method = `${codeType === "APR-DRG" ? `APR ${code} ≈ MS-DRG ${drgs.join("/")} avg weight ${w.toFixed(3)}` : `MS-DRG ${code} weight ${w.toFixed(3)}`}; ${h ? `${h.name} wage index, teaching & DSH add-ons` : `${stateName} average wage index, no teaching/DSH add-ons`}`;
    return { amount: ippsAmount(w, h, state), method, hospital: h?.name };
  }

  if (CLFS[code]) return { amount: CLFS[code], method: "Clinical Lab Fee Schedule (national)" };

  if (billingClass === "professional") {
    const a = pfsAmount(code, state);
    return a ? { amount: a, method: `Physician Fee Schedule, ${stateName}${GPCI.filter((g) => g.state === state).length > 1 ? " (localities averaged)" : ""}` } : { amount: null, reason: PFS[code]?.status === "N" ? "Not covered by Medicare (preventive)" : "No Physician Fee Schedule amount" };
  }

  // Facility (institutional) outpatient
  const wi = h?.wageIndex ?? (STATE_AVG[state] ?? R.massachusettsAverage).wageIndex;
  const adj = (rate: number) => rate * (R.opps.laborShare * wi + (1 - R.opps.laborShare));
  const where = h ? `${h.name} wage index` : `${stateName} average wage index`;
  if (OFFICE_EM.has(code) && OPPS.G0463?.rate) return { amount: adj(OPPS.G0463.rate), method: `OPPS clinic visit G0463 (APC ${OPPS.G0463.apc}), ${where}`, hospital: h?.name };
  const o = OPPS[code];
  if (o?.rate && OPPS_PAID.has(o.si)) return { amount: adj(o.rate), method: `OPPS APC ${o.apc} (SI ${o.si}), ${where}`, hospital: h?.name };
  if (o?.si === "A") { const a = pfsAmount(code, state); if (a) return { amount: a, method: "Paid under the Physician Fee Schedule in hospital outpatient (OPPS SI A)" }; }
  const why: Record<string, string> = { B: "Not separately payable under OPPS", M: "Not billable to Medicare by hospitals", E1: "Not covered by Medicare", N: "Packaged under OPPS", C: "Inpatient-only under Medicare" };
  return { amount: null, reason: why[o?.si ?? ""] ?? "No OPPS amount" };
}
