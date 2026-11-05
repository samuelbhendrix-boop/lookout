import Link from "next/link";
import { db } from "@/lib/db";
import { MRF_REGISTRY } from "@/lib/marketdata/tic";
import { fmtInt } from "@/components/charts";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  reportingPlans: "plans reported", employerIndexes: "employer index files", tocFiles: "TOC files", inNetworkFiles: "rate files",
  inNetworkFileRefs: "rate-file references", inNetworkTB: "TB of rate files", inNetworkMB: "MB of rate files", allowedAmountFiles: "allowed-amount files",
  nameMatchedIndexes: "name-matched NE indexes", neEmployersMatched: "NE employers matched", keptPlans: "plans kept", groupPlans: "group plans",
  reportingMonth: "reporting month", lastUpdated: "last updated", indexesRead: "indexes read", reportingStructures: "reporting structures",
};

export default async function TransparencyPage() {
  const rows = await db.mrfSource.findMany();
  return (
    <div className="space-y-5">
      <div>
        <Link href="/employers" className="text-sm text-stone-500 hover:text-stone-900">← Employers</Link>
        <h1 className="h1 mt-2">Transparency in Coverage files</h1>
        <p className="max-w-3xl text-sm text-stone-500">
          Federal rules require every insurer and administrator to publish, monthly, machine-readable files of negotiated in-network rates, out-of-network
          allowed amounts, and a table of contents listing every plan they insure or administer — including self-funded employers, by EIN. Lookout reads each
          carrier&apos;s table of contents and matches EINs to New England Form 5500 filers, which names the administrator of self-funded plans. Rate files
          are measured here; regional carriers&apos; rate files are reduced to a benchmark on the <Link className="underline" href="/rates">Rates</Link> page.
        </p>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-stone-200 text-left font-mono text-[11px] uppercase tracking-wide text-stone-500">
            <tr><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">How it publishes</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">What we found</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {MRF_REGISTRY.map((r) => {
              const s = rows.find((x) => x.id === r.id);
              const stats = (s?.stats ?? {}) as Record<string, number | string>;
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2">
                    <a className="font-medium underline decoration-stone-300 hover:decoration-stone-700" href={r.url} target="_blank" rel="noopener noreferrer">{r.carrier}</a>
                    {r.regional && <span className="ml-1 rounded bg-stone-100 px-1 text-[10px] text-stone-500">regional</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-stone-600">{r.method}{r.note && <span className="block text-stone-400">{r.note}</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    <span className={s?.status === "ok" ? "text-emerald-700" : s?.status === "failed" ? "text-red-600" : "text-stone-500"}>
                      {s?.status === "ok" ? "automated" : s?.status === "failed" ? "failed" : r.adapter ? "pending" : "manual (link)"}
                    </span>
                    {s?.lastRunAt && <span className="block text-stone-400">{s.lastRunAt.toISOString().slice(0, 10)}</span>}
                    {s?.error && <span className="block max-w-xs truncate text-red-600" title={s.error}>{s.error}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(stats).map(([k, v]) => (
                        <span key={k} className={`rounded px-1.5 py-0.5 ${k === "neEmployersMatched" ? "bg-amber-50 font-medium text-amber-800" : "bg-stone-100 text-stone-600"}`}>
                          {typeof v === "number" ? fmtInt(v) : v} {LABELS[k] ?? k}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">
        Manual carriers publish through JavaScript portals or sites that can&apos;t be enumerated automatically; their links open the official file locations.
        Refreshed monthly with the rest of the market data.
      </p>
    </div>
  );
}
