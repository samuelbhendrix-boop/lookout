import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import StreamArray from "stream-json/streamers/StreamArray";
import Parser from "stream-json/Parser";
import { db } from "../db";

/**
 * Plan provider directories and drug formularies from Exchange insurers' machine-readable files (CMS MR-PUF lists each
 * issuer's cms-data-index.json). Per plan: in-network hospitals, physician and primary-care counts, share accepting
 * new patients; formulary size, prior-authorization and step-therapy rates, and coverage of a watch list of high-cost
 * drugs. In New England these exist for the federal-platform state (NH) plus Anthem's CT and ME directories.
 */

const UA = { "User-Agent": "Mozilla/5.0 (compatible; PayersightBot; +https://github.com/samuelbhendrix-boop/lookout)" };
const NE = new Set(["MA", "CT", "RI", "NH", "VT", "ME"]);

/** From CMS's Exchange MR-PUF (New England rows) — issuer → index. WellSense's index is on port 8443, which our network can't reach. */
export const DIRECTORY_SOURCES: Array<{ carrier: string; issuers: string[]; index: string; providerFilter?: RegExp; formularyFilter?: RegExp }> = [
  { carrier: "Anthem Blue Cross and Blue Shield", issuers: ["96751", "57601"], index: "https://www22.elevancehealth.com/cms-data-index-json/Elevance-Health-Data-Index.json", providerFilter: /PROVIDERS_(NH|ME|CT)(_|\.)/ },
  { carrier: "Harvard Pilgrim Health Care", issuers: ["59025"], index: "https://www.harvardpilgrim.org/cmsjson/rest/index.json" },
  { carrier: "Ambetter (Centene)", issuers: ["75841"], index: "https://api.centene.com/ambetter/reference/cms-data-index.json", providerFilter: /provider_facility_/, formularyFilter: /-NH\.json/ },
  { carrier: "Matthew Thornton Health Plan", issuers: ["72953"], index: "https://cmsdata.providers4you.com/cms-data-index.json" },
  { carrier: "WellSense Health Plan", issuers: ["13219"], index: "https://connect.wellsense.org:8443/NHACA_MRF/data/cms-data-index.json" },
];

/** High-cost or high-interest drugs to compare coverage on. Matched on the RxNorm name (brand in brackets). */
export const WATCHLIST: Array<{ group: string; match: RegExp }> = [
  { group: "GLP-1 for weight loss (Wegovy, Zepbound)", match: /\[(wegovy|zepbound)\]/i },
  { group: "GLP-1 for diabetes (Ozempic, Mounjaro, Trulicity)", match: /\[(ozempic|mounjaro|trulicity|rybelsus|victoza)\]/i },
  { group: "Adalimumab (Humira and biosimilars)", match: /adalimumab/i },
  { group: "Dupixent", match: /dupilumab/i },
  { group: "Stelara / ustekinumab", match: /ustekinumab/i },
  { group: "Skyrizi", match: /risankizumab/i },
  { group: "Rinvoq", match: /upadacitinib/i },
  { group: "Eliquis / apixaban", match: /apixaban/i },
  { group: "Jardiance / Farxiga (SGLT2)", match: /empagliflozin|dapagliflozin/i },
  { group: "Entresto", match: /sacubitril/i },
  { group: "Biktarvy", match: /bictegravir/i },
  { group: "Trikafta", match: /elexacaftor/i },
  { group: "Insulin glargine", match: /insulin glargine/i },
  { group: "Repatha / Praluent (PCSK9)", match: /evolocumab|alirocumab/i },
];

export const PCP = /family|internal medicine|general practice|pediatric(?!.*(surg|cardio|neuro|onc))|primary care|geriatric/i;
const DIRECTORY_ID = "cache:directory";
const NE_STATES = ["MA", "CT", "RI", "NH", "VT", "ME"];

/** Which sources failed on the last run (shown as a disclosure). */
export async function directoryErrors(): Promise<{ errors: string[]; at: string } | null> {
  const row = await db.rateFile.findUnique({ where: { id: DIRECTORY_ID } });
  return (row?.stats as { errors: string[]; at: string } | null) ?? null;
}

export type PlanDirectory = { planId: string; year: number; individuals: number; pcps: number; acceptingPct: number | null; hospitals: number; neHospitals: number; facilities: number; drugs: number | null; paPct: number | null; stPct: number | null; watch: Array<{ group: string; covered: boolean; tier: string | null; pa: boolean; st: boolean }> };

/** Directory + formulary stats for a set of plans (latest year per plan); keyed by 14-char plan ID. */
export async function planDirectories(planIds: string[]): Promise<Map<string, PlanDirectory>> {
  const ids = [...new Set(planIds.map((p) => p.slice(0, 14)))];
  if (!ids.length) return new Map();
  const [stats, drugs, hosp] = await Promise.all([
    db.planNetworkStat.findMany({ where: { planId: { in: ids } }, orderBy: { year: "asc" } }),
    db.planDrug.findMany({ where: { planId: { in: ids } } }),
    db.planHospital.groupBy({ by: ["planId", "year"], where: { planId: { in: ids }, state: { in: NE_STATES } }, _count: { _all: true } }),
  ]);
  const out = new Map<string, PlanDirectory>();
  for (const s of stats) {
    out.set(s.planId, {
      planId: s.planId, year: s.year, individuals: s.individuals, pcps: s.pcps, acceptingPct: s.individuals ? s.accepting / s.individuals : null,
      hospitals: s.hospitals, neHospitals: hosp.find((h) => h.planId === s.planId && h.year === s.year)?._count._all ?? 0, facilities: s.facilities,
      drugs: s.drugs, paPct: s.drugs ? (s.pa ?? 0) / s.drugs : null, stPct: s.drugs ? (s.st ?? 0) / s.drugs : null,
      watch: drugs.filter((d) => d.planId === s.planId && d.year === s.year).map((d) => ({ group: d.group, covered: d.covered, tier: d.tier, pa: d.pa, st: d.st })).sort((a, b) => a.group.localeCompare(b.group)),
    });
  }
  return out;
}

/** In-network New England hospitals for one plan (latest year). */
export async function planHospitals(planId: string) {
  const latest = await db.planNetworkStat.findFirst({ where: { planId: planId.slice(0, 14) }, orderBy: { year: "desc" } });
  if (!latest) return [];
  return db.planHospital.findMany({ where: { planId: latest.planId, year: latest.year, state: { in: NE_STATES } }, orderBy: [{ state: "asc" }, { name: "asc" }], distinct: ["npi"] });
}

const stateOf = (planId: string) => planId.slice(5, 7);

type Plan = { plan_id?: string; years?: number[]; drug_tier?: string; prior_authorization?: boolean; step_therapy?: boolean; quantity_limit?: boolean };

async function fetchToFile(url: string, file: string) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url.split("?")[0]}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
}
/** Every file is a JSON array of records; stream it. */
async function* records(file: string): AsyncGenerator<Record<string, unknown>> {
  for await (const { value } of createReadStream(file).pipe(new Parser()).pipe(new StreamArray()) as AsyncIterable<{ value: Record<string, unknown> }>) yield value;
}

export async function importDirectories(): Promise<{ rows: number; errors: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), "dir-"));
  const errors: string[] = [];
  let rows = 0;
  const minYear = new Date().getUTCFullYear();
  try {
    for (const src of DIRECTORY_SOURCES) {
      let index: { provider_urls?: string[]; formulary_urls?: string[] };
      try {
        const res = await fetch(src.index, { headers: UA, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        index = await res.json();
      } catch (e) {
        errors.push(`${src.carrier}: index unreachable (${(e as Error).message.slice(0, 80)})`);
        continue;
      }
      const isMine = (planId: string) => src.issuers.includes(planId.slice(0, 5)) && NE.has(stateOf(planId));
      // Per plan-year accumulators.
      const stat = new Map<string, { planId: string; year: number; individuals: number; pcps: number; accepting: number; hospitals: number; facilities: number; byState: Record<string, number>; drugs: number; pa: number; st: number; ql: number }>();
      const hospitals: Array<{ planId: string; year: number; npi: string; name: string; city: string | null; state: string | null }> = [];
      const drugs = new Map<string, { planId: string; year: number; group: string; tiers: Set<string>; pa: boolean; st: boolean; ql: boolean; n: number }>();
      const S = (planId: string, year: number) => {
        const k = `${year}:${planId}`;
        return stat.get(k) ?? stat.set(k, { planId, year, individuals: 0, pcps: 0, accepting: 0, hospitals: 0, facilities: 0, byState: {}, drugs: 0, pa: 0, st: 0, ql: 0 }).get(k)!;
      };
      const planYears = (plans: Plan[] | undefined) => (plans ?? []).flatMap((p) => (p.plan_id && isMine(p.plan_id) ? (p.years?.length ? p.years : [minYear]).filter((y) => y >= minYear).map((y) => ({ p, planId: p.plan_id!.slice(0, 14), year: y })) : []));

      for (const url of (index.provider_urls ?? []).filter((u) => !src.providerFilter || src.providerFilter.test(u))) {
        const file = join(dir, "p.json");
        try {
          await fetchToFile(url, file);
          for await (const r of records(file)) {
            const py = planYears(r.plans as Plan[]);
            if (!py.length) continue;
            const addr = ((r.addresses as Array<{ city?: string; state?: string }>) ?? [])[0] ?? {};
            if (r.type === "FACILITY") {
              const types = ((r.facility_type as string[]) ?? []).join(" ");
              const isHosp = /hospital/i.test(types);
              const name = String(r.facility_name ?? "");
              for (const x of py) {
                const s = S(x.planId, x.year);
                s.facilities++;
                if (isHosp) { s.hospitals++; hospitals.push({ planId: x.planId, year: x.year, npi: String(r.npi ?? ""), name, city: addr.city ?? null, state: addr.state ?? null }); }
              }
            } else {
              const spec = ((r.specialty as string[]) ?? []).join(" ");
              const pcp = PCP.test(spec);
              const accepting = /^accepting/i.test(String(r.accepting ?? ""));
              for (const x of py) {
                const s = S(x.planId, x.year);
                s.individuals++;
                if (pcp) s.pcps++;
                if (accepting) s.accepting++;
                if (addr.state) s.byState[addr.state] = (s.byState[addr.state] ?? 0) + 1;
              }
            }
          }
        } catch (e) {
          errors.push(`${src.carrier}: ${url.split("/").pop()?.split("?")[0]} — ${(e as Error).message.slice(0, 80)}`);
        } finally {
          await rm(file, { force: true });
        }
      }
      for (const url of (index.formulary_urls ?? []).filter((u) => !src.formularyFilter || src.formularyFilter.test(u))) {
        const file = join(dir, "d.json");
        try {
          await fetchToFile(url, file);
          for await (const r of records(file)) {
            const name = String(r.drug_name ?? "");
            const group = WATCHLIST.find((w) => w.match.test(name))?.group;
            for (const x of planYears(r.plans as Plan[])) {
              const s = S(x.planId, x.year);
              s.drugs++;
              if (x.p.prior_authorization) s.pa++;
              if (x.p.step_therapy) s.st++;
              if (x.p.quantity_limit) s.ql++;
              if (group) {
                const k = `${x.year}:${x.planId}:${group}`;
                const d = drugs.get(k) ?? drugs.set(k, { planId: x.planId, year: x.year, group, tiers: new Set(), pa: false, st: false, ql: false, n: 0 }).get(k)!;
                d.n++;
                if (x.p.drug_tier) d.tiers.add(x.p.drug_tier);
                d.pa ||= !!x.p.prior_authorization; d.st ||= !!x.p.step_therapy; d.ql ||= !!x.p.quantity_limit;
              }
            }
          }
        } catch (e) {
          errors.push(`${src.carrier}: formulary ${url.split("/").pop()?.split("?")[0]} — ${(e as Error).message.slice(0, 80)}`);
        } finally {
          await rm(file, { force: true });
        }
      }
      if (!stat.size) { errors.push(`${src.carrier}: no New England plans found in its files`); continue; }
      const hasFormulary = [...stat.values()].some((s) => s.drugs > 0);
      // Watch-list groups a plan doesn't list at all are recorded as not covered (only when its formulary was read).
      const drugRows: Array<{ carrier: string; planId: string; year: number; group: string; covered: boolean; tier: string | null; pa: boolean; st: boolean; ql: boolean; drugs: number }> = [...drugs.values()].map((d) => ({ carrier: src.carrier, planId: d.planId, year: d.year, group: d.group, covered: true, tier: [...d.tiers].map((t) => t.toLowerCase().replace(/-/g, " ")).join("; ").slice(0, 200) || null, pa: d.pa, st: d.st, ql: d.ql, drugs: d.n }));
      if (hasFormulary) for (const s of stat.values()) if (s.drugs > 0) for (const w of WATCHLIST) if (!drugs.has(`${s.year}:${s.planId}:${w.group}`)) drugRows.push({ carrier: src.carrier, planId: s.planId, year: s.year, group: w.group, covered: false, tier: null, pa: false, st: false, ql: false, drugs: 0 });
      await db.$transaction(async (tx) => {
        await tx.planNetworkStat.deleteMany({ where: { carrier: src.carrier } });
        await tx.planHospital.deleteMany({ where: { carrier: src.carrier } });
        await tx.planDrug.deleteMany({ where: { carrier: src.carrier } });
        await tx.planNetworkStat.createMany({ data: [...stat.values()].map((s) => ({ id: `${s.year}:${s.planId}`, carrier: src.carrier, issuerId: s.planId.slice(0, 5), planId: s.planId, year: s.year, individuals: s.individuals, pcps: s.pcps, accepting: s.accepting, hospitals: s.hospitals, facilities: s.facilities, byState: s.byState, drugs: s.drugs || null, pa: s.drugs ? s.pa : null, st: s.drugs ? s.st : null, ql: s.drugs ? s.ql : null })), skipDuplicates: true });
        for (let i = 0; i < hospitals.length; i += 2000) await tx.planHospital.createMany({ data: hospitals.slice(i, i + 2000).map((h) => ({ ...h, carrier: src.carrier })) });
        for (let i = 0; i < drugRows.length; i += 2000) await tx.planDrug.createMany({ data: drugRows.slice(i, i + 2000) });
      }, { timeout: 300_000 });
      rows += stat.size + hospitals.length + drugRows.length;
    }
    const data = { carrier: "_cache", carrierName: "_cache", network: "directory", url: "", status: "cache", stats: { errors, at: new Date().toISOString() }, processedAt: new Date() };
    await db.rateFile.upsert({ where: { id: DIRECTORY_ID }, create: { id: DIRECTORY_ID, ...data }, update: data });
    return { rows, errors };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
