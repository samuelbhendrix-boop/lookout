import Link from "next/link";
import { DataAsOf } from "@/components/DataAsOf";
import { leverage } from "@/lib/marketdata/mrf/leverage";
import { NotIncluded } from "@/components/NotIncluded";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATES = ["MA", "NH", "RI", "ME", "CT", "VT", "all"];
const x = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}×`);
const short = (n: string) => n.replace(/Blue Cross (and|&) Blue Shield( of)?/i, "BCBS").replace(/Anthem BCBS \((\w+).*\)/, "Anthem $1").replace(/ Health (Plan|Care)$/, "").replace(/Mass General Brigham/, "MGB").replace(/Neighborhood Health Plan of Rhode Island/, "NHPRI").replace(/Harvard Pilgrim/, "Harvard Pilgrim");
/** Cell shade by multiple of Medicare: green near Medicare, red at 2.5× and up. */
const shade = (v: number) => (v < 1.2 ? "bg-emerald-50 text-emerald-900" : v < 1.6 ? "bg-stone-50" : v < 2 ? "bg-amber-50 text-amber-900" : v < 2.5 ? "bg-orange-100 text-orange-900" : "bg-red-100 text-red-900");

export default async function LeveragePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const state = STATES.includes(sp.state ?? "") ? sp.state! : "MA";
  const L = await leverage();
  if (!L || !L.rows.length) return <div className="space-y-4"><h1 className="h1">Price leverage</h1><Empty title="Not built yet">Built from negotiated rates after the next rate import or history rebuild (System status → Rebuild now).</Empty></div>;
  FEE_SCHEDULE = new Set(L.carriers.filter((c) => c.uniform).map((c) => c.carrier));
  const rows = L.rows.filter((r) => state === "all" || r.state === state);
  const ids = [...new Set(rows.flatMap((r) => Object.keys(r.carriers)))];
  const carriers = L.carriers.filter((c) => ids.includes(c.carrier));
  const focus = carriers.find((c) => c.carrier === sp.carrier)?.carrier;
  const name = new Map(L.carriers.map((c) => [c.carrier, c.carrierName]));
  const sorted = focus
    ? [...rows].filter((r) => r.carriers[focus]).sort((a, b) => rel(b, focus) - rel(a, focus))
    : rows;
  const qs = (o: Record<string, string | undefined>) => `/leverage?${new URLSearchParams(Object.entries({ state, carrier: focus, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const uniform = L.carriers.filter((c) => c.uniform);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Price leverage</h1>
        <DataAsOf datasets={["rates"]} />
        <p className="max-w-3xl text-sm text-stone-500">
          What each carrier pays each hospital, as a multiple of what Medicare pays that same hospital for the same services (facility charges: inpatient
          stays and hospital outpatient services). At each hospital, carriers are compared on the services 2+ of them price there. Rate files from {L.month}.
        </p>
      </div>
      <div className="flex flex-wrap gap-1 text-xs">
        {STATES.map((s) => <Link key={s} href={qs({ state: s })} className={`rounded px-2.5 py-1 ${state === s ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>{s === "all" ? "All New England" : s}</Link>)}
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold tracking-tight">By carrier · {state === "all" ? "New England" : state}</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
              <tr><th className="px-3 py-2">Carrier</th><th className="px-3 py-2 text-right">Hospitals</th><th className="px-3 py-2 text-right">Median × Medicare</th><th className="px-3 py-2 text-right">vs other carriers, same hospital</th><th className="px-3 py-2 text-right">Best deal at</th><th className="px-3 py-2 text-right">Worst deal at</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {carriers.map((c) => {
                const mine = rows.filter((r) => r.carriers[c.carrier]);
                const rels = mine.map((r) => rel(r, c.carrier)).filter((v) => Number.isFinite(v) && v > 0);
                const vsPeers = rels.length >= 3 ? med(rels) : null;
                return (
                  <tr key={c.carrier} className={focus === c.carrier ? "bg-stone-50" : ""}>
                    <td className="px-3 py-2 font-medium">{c.carrierName}{c.uniform && <span className="ml-2 rounded bg-stone-100 px-1 text-[10px] font-normal text-stone-500">fee schedule</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{mine.length}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x(med(mine.map((r) => r.carriers[c.carrier].pct)))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.uniform || vsPeers == null ? "—" : <span className={vsPeers < 0.95 ? "text-emerald-700" : vsPeers > 1.05 ? "text-red-600" : ""}>{vsPeers > 1 ? "+" : ""}{Math.round((vsPeers - 1) * 100)}%</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.uniform ? "—" : mine.filter((r) => r.low === c.carrier).length}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.uniform ? "—" : mine.filter((r) => r.high === c.carrier).length}</td>
                    <td className="px-3 py-2 text-right text-xs"><Link className="underline" href={qs({ carrier: focus === c.carrier ? undefined : c.carrier })}>{focus === c.carrier ? "clear" : "focus"}</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-stone-500">&quot;vs other carriers&quot; = median, across hospitals, of this carrier&apos;s multiple ÷ the median of the other carriers&apos; multiples at that hospital. −10% means it pays 10% less than its peers for the same care.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold tracking-tight">{focus ? `Where ${name.get(focus)} pays most relative to peers` : "By hospital"}</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
              <tr><th className="px-3 py-2">Hospital</th>{carriers.map((c) => <th key={c.carrier} className={`px-2 py-2 text-right ${focus === c.carrier ? "text-stone-900" : ""}`}>{short(c.carrierName).slice(0, 14)}</th>)}<th className="px-3 py-2 text-right">Spread</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sorted.slice(0, 150).map((r) => (
                <tr key={r.tin}>
                  <td className="max-w-[240px] px-3 py-1.5"><span className="font-medium">{r.name}</span><div className="text-[10px] text-stone-500">{r.state}{r.type ? ` · ${r.type.replace(" Hospitals", "")}` : ""}</div></td>
                  {carriers.map((c) => {
                    const v = r.carriers[c.carrier];
                    return (
                      <td key={c.carrier} title={v ? `${v.n} services · inpatient ${x(v.inpatient)} · outpatient ${x(v.outpatient)}` : undefined} className={`px-2 py-1.5 text-right tabular-nums ${v ? shade(v.pct) : "text-stone-300"} ${focus === c.carrier ? "font-semibold" : ""} ${r.low === c.carrier ? "underline decoration-emerald-600 decoration-2" : r.high === c.carrier ? "underline decoration-red-500 decoration-2" : ""}`}>
                        {v ? x(v.pct) : "·"}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.spread ? x(r.spread) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-stone-500">Green underline = best deal at that hospital, red = worst. Hover a cell for the number of services compared and the inpatient/outpatient split. {sorted.length > 150 ? `Showing 150 of ${sorted.length}.` : ""}</p>
      </section>

      {L.published && (() => {
        const P = L.published;
        const prow = P.rows.filter((r) => state === "all" || r.state === state);
        const pcols = P.columns.filter((c) => prow.some((r) => r.cells[c.key])).slice(0, 14);
        if (!prow.length) return null;
        return (
          <section className="space-y-2">
            <h2 className="font-semibold tracking-tight">As hospitals publish them · by carrier and product</h2>
            <p className="max-w-3xl text-xs text-stone-500">From each hospital&apos;s own price transparency file ({P.files} files). Fills carriers whose own rate files we can&apos;t reach (BCBSMA&apos;s PPO, WellSense) and splits each carrier by product. Same method: median multiple of the hospital&apos;s Medicare rate over services 2+ payers price there.</p>
            <div className="card overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
                  <tr><th className="px-3 py-2">Hospital</th>{pcols.map((c) => <th key={c.key} className="px-2 py-2 text-right normal-case tracking-normal" title={`${c.carrier} · ${c.product}`}><div className="max-w-[6rem] truncate">{short(c.carrier)}</div><div className="font-normal text-stone-400">{c.product}</div></th>)}</tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {prow.slice(0, 80).map((r) => (
                    <tr key={r.hospital}>
                      <td className="max-w-[220px] px-3 py-1.5"><span className="font-medium">{r.hospital}</span><div className="text-[10px] text-stone-500">{r.state}{r.tin ? "" : " · Medicare: state average"}</div></td>
                      {pcols.map((c) => { const v = r.cells[c.key]; return <td key={c.key} title={v ? `${v.n} services · inpatient ${x(v.inpatient)} · outpatient ${x(v.outpatient)}` : undefined} className={`px-2 py-1.5 text-right tabular-nums ${v ? shade(v.pct) : "text-stone-300"}`}>{v ? x(v.pct) : "·"}</td>; })}
                    </tr>
                  ))}
                  <tr className="border-t border-stone-300 font-medium"><td className="px-3 py-1.5">Median across hospitals</td>{pcols.map((c) => { const xs = prow.map((r) => r.cells[c.key]?.pct).filter((v): v is number => v != null); return <td key={c.key} className="px-2 py-1.5 text-right tabular-nums">{x(med(xs))}</td>; })}</tr>
                </tbody>
              </table>
            </div>
            {P.check.length > 0 && (
              <p className="text-xs text-stone-500">
                Cross-check where a carrier&apos;s own file and the hospital&apos;s file price the same service: {P.check.map((c) => `${short(c.carrier)} ${Math.round(c.medianDiff * 100)}% median difference (${c.pairs} services)`).join(" · ")}.
                Differences come from different products, effective dates, or which of several listed rates is used.
              </p>
            )}
          </section>
        );
      })()}

      <NotIncluded items={[
        uniform.length ? <>{uniform.map((c) => c.carrierName).join(", ")}: the same multiple at many hospitals, which means the file publishes one network-wide fee schedule rather than each hospital&apos;s contract. Shown, but left out of best/worst rankings and peer comparisons.</> : null,
        <>Hospitals priced by only one carrier in the files we reduce (most of Connecticut, much of Maine) have nothing to compare and are left out.</>,
        <>{L.excluded.outliers.toLocaleString()} provider × service prices outside 0.2–10× Medicare (bundled case rates or file errors) and {L.excluded.noMedicare.toLocaleString()} with no Medicare equivalent were excluded.</>,
        <>Carriers&apos; own rate files don&apos;t cover BCBSMA&apos;s PPO networks or WellSense; the hospital-published section fills them where hospitals list them. Hospitals whose files couldn&apos;t be read are listed on System status.</>,
        <>Medicare is the hospital&apos;s own rate (wage index, teaching and safety-net adjustments) where the hospital is matched, else the state average.</>,
      ]} />
    </div>
  );
}

function med(xs: number[]) { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; }
/** A carrier's multiple at a hospital relative to the other carriers there. */
let FEE_SCHEDULE = new Set<string>();
function rel(r: { carriers: Record<string, { pct: number }> }, c: string) {
  const others = Object.entries(r.carriers).filter(([k]) => k !== c && !FEE_SCHEDULE.has(k)).map(([, v]) => v.pct);
  return r.carriers[c] && others.length ? r.carriers[c].pct / med(others)! : -Infinity;
}
