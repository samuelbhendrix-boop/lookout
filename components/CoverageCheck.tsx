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
                <td className="px-3 py-1.5 text-right tabular-nums" title={r.selfSource ?? "Not published by this state"}>{r.selfFunded != null ? k(r.selfFunded) : <span className="text-stone-400">not published</span>}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{k(r.kffEmployer)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${tone(r.employerCapture)}`}>{pc(r.employerCapture)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-stone-600">{k(r.unseen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 border-t border-stone-100 px-4 py-3 text-xs text-stone-600">
        <p><span className="font-medium">Individual</span>: the CMS loss-ratio filings ({year}) count every fully insured individual policy, on and off the exchange, grandfathered included, so they land close to KFF. The remainder is mostly survey reporting differences and non-ACA coverage (short-term plans, health-care sharing ministries).</p>
        <p><span className="font-medium">Employer</span>: the filings cover fully insured group only. Self-funded (ASO) employers are added where the state publishes them (Massachusetts, New Hampshire). &quot;Not visible&quot; is everything else KFF counts as employer coverage: above all self-funded employers in CT, RI, VT and ME, plus federal employees (FEHB), level-funded and association plans, and residents covered by a policy written in another state. National carriers&apos; and BCBS plans&apos; ASO books sit mostly in that gap, so <span className="font-medium">group market shares outside MA and NH are shares of the fully insured market only</span>.</p>
        <p>Massachusetts uses CHIA for both fully and self-insured group (the federal filing counts some BCBSMA accounts as fully insured that CHIA counts as self-insured, so mixing sources would double count). Form 5500 can&apos;t fill the gap: it reports a company&apos;s employees nationwide under its headquarters state (CVS alone shows ~500K in Rhode Island). KFF counts people by residence and main coverage; the filings count policies by the state they&apos;re written in, so small differences either way are expected. Source: <a className="underline" href={kff.url} target="_blank" rel="noopener noreferrer">{kff.source}, {kff.year}</a>.</p>
      </div>
    </details>
  );
}
