import { db } from "@/lib/db";
import { planDirectories, type PlanDirectory } from "@/lib/marketdata/directory";

const NE = ["MA", "CT", "RI", "NH", "VT", "ME"];
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const int = (n: number) => n.toLocaleString("en-US");

/**
 * Provider network and formulary per plan, from the insurer's own machine-readable directory and formulary files.
 * Renders nothing when none of the plans are covered (those files only exist for federal-platform states and a few issuers).
 */
export async function PlanNetworkTable({ plans, title = "Network and formulary" }: { plans: Array<{ planId: string; name: string; metal?: string | null; issuer?: string }>; title?: string }) {
  const dirs = await planDirectories(plans.map((p) => p.planId));
  const rows = plans.map((p) => ({ p, d: dirs.get(p.planId.slice(0, 14)) })).filter((x): x is { p: typeof x.p; d: PlanDirectory } => !!x.d);
  if (!rows.length) return null;

  // Group plans that share the exact same in-network hospital list → "networks".
  const ids = [...new Set(rows.map((r) => r.d.planId))];
  const years = new Map(rows.map((r) => [r.d.planId, r.d.year]));
  const hosp = await db.planHospital.findMany({ where: { planId: { in: ids }, state: { in: NE } }, select: { planId: true, year: true, npi: true, name: true, city: true, state: true } });
  const byPlan = new Map<string, Map<string, { name: string; city: string | null; state: string | null }>>();
  for (const h of hosp) {
    if (years.get(h.planId) !== h.year) continue;
    (byPlan.get(h.planId) ?? byPlan.set(h.planId, new Map()).get(h.planId)!).set(h.npi, h);
  }
  const groups = new Map<string, { plans: string[]; hospitals: Array<{ name: string; city: string | null; state: string | null }> }>();
  for (const r of rows) {
    const set = byPlan.get(r.d.planId) ?? new Map();
    const sig = [...set.keys()].sort().join(",");
    const g = groups.get(sig) ?? groups.set(sig, { plans: [], hospitals: [...set.values()].sort((a, b) => (a.state ?? "").localeCompare(b.state ?? "") || a.name.localeCompare(b.name)) }).get(sig)!;
    g.plans.push(r.p.name);
  }
  const watchGroups = [...new Set(rows.flatMap((r) => r.d.watch.map((w) => w.group)))].sort();
  const withFormulary = rows.filter((r) => r.d.drugs);

  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-semibold tracking-tight">{title}</h3>
        <p className="text-xs text-stone-500">
          From the insurer&apos;s own provider directory and formulary files (CMS requires these for federal-platform exchange plans). Hospitals = in-network
          hospitals in New England. Physicians and PCPs are individual clinicians listed for the plan with a New England practice address; accepting = listed as accepting new patients.
          Plan year {[...new Set(rows.map((r) => r.d.year))].join("/")}.
        </p>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
            <tr><th className="px-3 py-2">Plan</th><th className="px-3 py-2 text-right">NE hospitals</th><th className="px-3 py-2 text-right">Physicians</th><th className="px-3 py-2 text-right">PCPs</th><th className="px-3 py-2 text-right">Accepting</th><th className="px-3 py-2 text-right">Drugs listed</th><th className="px-3 py-2 text-right">Prior auth</th><th className="px-3 py-2 text-right">Step therapy</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map(({ p, d }) => (
              <tr key={p.planId}>
                <td className="min-w-[220px] px-3 py-1.5">{p.issuer && <span className="text-stone-500">{p.issuer} · </span>}{p.name}{p.metal && <span className="text-stone-400"> · {p.metal}</span>}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{int(d.neHospitals)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{int(d.individuals)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{int(d.pcps)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{pct(d.acceptingPct)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{d.drugs == null ? "—" : int(d.drugs)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{pct(d.paPct)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{pct(d.stPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {groups.size > 0 && (
        <div className="space-y-1">
          {[...groups.values()].sort((a, b) => b.hospitals.length - a.hospitals.length).map((g, i) => (
            <details key={i} className="card px-4 py-2 text-sm">
              <summary className="cursor-pointer">
                <span className="font-medium">{int(g.hospitals.length)} New England hospitals</span>
                <span className="text-stone-500"> · {g.plans.length} plan{g.plans.length === 1 ? "" : "s"}: {g.plans.slice(0, 3).join(", ")}{g.plans.length > 3 ? ` +${g.plans.length - 3}` : ""}</span>
              </summary>
              <ul className="mt-2 columns-1 gap-6 text-xs text-stone-600 sm:columns-2 lg:columns-3">
                {g.hospitals.map((h, j) => <li key={j} className="break-inside-avoid">{h.name}{h.city ? <span className="text-stone-400"> · {h.city}, {h.state}</span> : null}</li>)}
              </ul>
            </details>
          ))}
        </div>
      )}

      {withFormulary.length > 0 && watchGroups.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
              <tr><th className="px-3 py-2">High-cost drugs</th>{withFormulary.map(({ p }) => <th key={p.planId} className="max-w-[120px] px-2 py-2 font-normal normal-case">{p.name}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {watchGroups.map((g) => (
                <tr key={g}>
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium">{g}</td>
                  {withFormulary.map(({ p, d }) => {
                    const w = d.watch.find((x) => x.group === g);
                    return (
                      <td key={p.planId} className="px-2 py-1.5" title={w?.tier ?? undefined}>
                        {!w ? <span className="text-stone-300">—</span> : !w.covered ? <span className="text-red-600">not listed</span> : <span className="text-emerald-700">covered{w.pa ? <span className="text-amber-700"> · PA</span> : null}{w.st ? <span className="text-amber-700"> · ST</span> : null}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-stone-500">PA = prior authorization, ST = step therapy. Hover for the formulary tier. &quot;Not listed&quot; means no form of the drug appears in the plan&apos;s formulary file (some specialty drugs are billed under the medical benefit instead).</p>
        </div>
      )}
    </section>
  );
}
