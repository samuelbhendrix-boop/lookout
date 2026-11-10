import { coverageCheck } from "@/lib/marketdata/coverage";

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1000)}K`);
const pc = (v: number) => `${Math.round(v * 100)}%`;
const tone = (v: number) => (v >= 0.85 ? "text-emerald-700" : v >= 0.5 ? "text-amber-700" : "text-red-600");

/** What share of each state's commercial market the app's numbers capture, against KFF's independent count. */
export async function CoverageCheck({ open = false, highlight }: { open?: boolean; highlight?: string }) {
  const { year, kff, rows } = await coverageCheck();
  if (!year || !rows.length) return null;
  return (
    <details className="card" open={open}>
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium">How much of the commercial market these numbers see · checked against KFF {kff.year}</summary>
      <div className="overflow-x-auto border-t border-stone-100">
        <table className="w-full text-sm" data-static>
          <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2 text-right">Individual (ours)</th><th className="px-3 py-2 text-right">KFF non-group</th><th className="px-3 py-2 text-right">Seen</th>
              <th className="px-3 py-2 text-right">Group fully insured</th><th className="px-3 py-2 text-right">+ Self-funded</th><th className="px-3 py-2 text-right">KFF employer</th><th className="px-3 py-2 text-right">Seen</th><th className="px-3 py-2 text-right">Not visible</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r) => (
              <tr key={r.state} className={r.state === highlight ? "bg-stone-50 font-medium" : ""}>
                <td className="px-3 py-1.5">{r.state}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{k(r.individual)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{k(r.kffNonGroup)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${tone(r.individualCapture)}`}>{pc(r.individualCapture)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{k(r.fullyInsuredGroup)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums" title={r.selfSource ?? "Not available"}>{r.selfFunded != null ? <>{k(r.selfFunded)}{!r.residentBasis && <sup className="text-stone-400">†</sup>}</> : <span className="text-stone-400">not available</span>}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{k(r.kffEmployer)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${tone(Math.min(1, r.employerCapture))}`}>{pc(r.employerCapture)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-stone-600">{r.unseen > 0 ? k(r.unseen) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 border-t border-stone-100 px-4 py-3 text-xs text-stone-600">
        <p><span className="font-medium">Individual</span>: the CMS loss-ratio filings ({year}) count every fully insured individual policy, on and off the exchange, grandfathered included, so they land close to KFF. The remainder is mostly survey reporting differences and non-ACA coverage (short-term plans, health-care sharing ministries).</p>
        <p><span className="font-medium">Employer</span>: fully insured group from the loss-ratio filings, plus self-funded (ASO) lives. Massachusetts uses CHIA&apos;s actual resident counts for both. <sup>†</sup>The other states use the self-funded lives carriers file with CMS (the NAIC exhibit&apos;s &quot;uninsured plans&quot;), which are counted by <span className="font-medium">the state the contract is written in</span>, not where members live, with estimates for Aetna and UnitedHealthcare, who don&apos;t file by state. That is why Connecticut can exceed 100% (Cigna, Aetna and Anthem write national accounts there) while Vermont and Maine stay well short. So outside Massachusetts, read &quot;seen&quot; as how much business is on the books in that state, not a count of covered residents.</p>
        <p>Still not visible anywhere: plans run by independent administrators (UMR, Meritain and the like), federal employees (FEHB), level-funded and association plans, and Blue plans&apos; out-of-state national accounts. Form 5500 can&apos;t fill the gap (it reports a company&apos;s employees nationwide under its headquarters state). KFF counts people by residence and main coverage. Source: <a className="underline" href={kff.url} target="_blank" rel="noopener noreferrer">{kff.source}, {kff.year}</a>; method check on the Self-funded view.</p>
      </div>
    </details>
  );
}
