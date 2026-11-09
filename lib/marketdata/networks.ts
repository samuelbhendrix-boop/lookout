import { db } from "../db";
import directory from "../../data/networks/hospitals.json";
import tinMap from "../../data/medicare/hospital-tins.json";

/**
 * Hospital networks inferred from negotiated-rate files: a carrier "has" a hospital when its files price care there
 * (inpatient DRGs, or facility outpatient services). Absence means "not priced in the files we reduced" — usually out
 * of network, but not proof of it. Hospitals whose TIN we can't tie to a rate file are shown as unknown, not as out.
 */
export type Hospital = { ccn: string; name: string; city: string; state: string; type: string; stars: number | null; er: boolean; lat: number | null; lon: number | null; approx?: boolean };
export const HOSPITALS = (directory as { hospitals: Hospital[] }).hospitals;
export const DIRECTORY_DATE = (directory as { generated: string }).generated;

const T = tinMap as { map: Record<string, string>; auto?: Record<string, string>; nonIpps?: Record<string, string> };
const TIN_TO_CCN: Record<string, string> = { ...(T.auto ?? {}), ...(T.nonIpps ?? {}), ...T.map };
const CCN_TINS = new Map<string, string[]>();
for (const [tin, ccn] of Object.entries(TIN_TO_CCN)) CCN_TINS.set(ccn, [...(CCN_TINS.get(ccn) ?? []), tin]);

/** Types counted in breadth (general hospitals people choose a network for). */
export const GENERAL = new Set(["Acute Care Hospitals", "Critical Access Hospitals", "Childrens"]);

export type Presence = { inpatient: boolean; outpatient: boolean };

export async function networkMatrix(state: string) {
  const latest = await db.rateHistory.aggregate({ _max: { month: true } });
  const month = latest._max.month;
  const hospitals = HOSPITALS.filter((h) => state === "all" || h.state === state);
  const tins = hospitals.flatMap((h) => CCN_TINS.get(h.ccn) ?? []);
  const rows = month && tins.length
    ? await db.$queryRaw<Array<{ carrier: string; carrierName: string; tin: string; inpatient: boolean; outpatient: boolean }>>`
        SELECT carrier, max("carrierName") "carrierName", tin,
               bool_or("codeType" LIKE '%DRG') inpatient, bool_or("codeType" = 'CPT') outpatient
        FROM "RateHistory" WHERE month = ${month} AND "billingClass" = 'institutional' AND tin = ANY(${tins})
        GROUP BY carrier, tin`
    : [];
  const carrierNames = new Map(rows.map((r) => [r.carrier, r.carrierName]));
  const byCcn = new Map<string, Record<string, Presence>>();
  for (const r of rows) {
    const ccn = TIN_TO_CCN[r.tin];
    const m = byCcn.get(ccn) ?? {};
    const p = m[r.carrier] ?? { inpatient: false, outpatient: false };
    p.inpatient ||= r.inpatient;
    p.outpatient ||= r.outpatient;
    m[r.carrier] = p;
    byCcn.set(ccn, m);
  }
  const list = hospitals.map((h) => ({ ...h, matched: CCN_TINS.has(h.ccn), carriers: byCcn.get(h.ccn) ?? {} }));
  const general = list.filter((h) => GENERAL.has(h.type) && h.matched);
  const carriers = [...carrierNames.entries()]
    .map(([carrier, carrierName]) => {
      const inNet = general.filter((h) => h.carriers[carrier]);
      return {
        carrier, carrierName,
        hospitals: inNet.length,
        inpatient: inNet.filter((h) => h.carriers[carrier].inpatient).length,
        breadth: general.length ? inNet.length / general.length : 0,
      };
    })
    .sort((a, b) => b.hospitals - a.hospitals);
  const pricedBy = (h: (typeof list)[number]) => Object.keys(h.carriers).length;
  return {
    month,
    hospitals: list.sort((a, b) => pricedBy(b) - pricedBy(a) || a.name.localeCompare(b.name)),
    carriers,
    general: general.length,
    unmatched: list.filter((h) => GENERAL.has(h.type) && !h.matched),
    singleCarrier: general.filter((h) => pricedBy(h) === 1).map((h) => ({ name: h.name, carrier: carrierNames.get(Object.keys(h.carriers)[0]) })),
  };
}
