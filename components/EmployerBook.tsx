import Link from "next/link";
import type { competitorEmployers } from "@/lib/marketdata/employers";
import { fmtInt } from "./charts";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export function EmployerBook({ data, competitorId, state }: { data: Awaited<ReturnType<typeof competitorEmployers>>; competitorId: string; state?: string }) {
  if (!data.employers) return null;
  const maxM = Math.max(...data.renewalMonths, 1);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Employer book</h2>
          <p className="text-xs text-stone-500">New England employers (100+ participants) naming this carrier on their Form 5500, or listed in its Transparency in Coverage files as an insured or administered (ASO) plan.</p>
        </div>
        <Link className="btn-ghost" href={`/employers?competitorId=${competitorId}${state ? `&state=${state}` : ""}`}>All employers →</Link>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="card p-4">
          <p className="font-mono text-[11px] uppercase tracking-wide text-stone-500">Employers</p>
          <p className="text-2xl font-semibold tabular-nums">{fmtInt(data.employers)}</p>
          <p className="text-xs text-stone-500">{fmtInt(data.persons)} persons covered · {data.insured} with premium reported{data.viaTransparency ? ` · ${data.viaTransparency} self-funded clients found via transparency files` : ""}</p>
        </div>
        <div className="card p-4">
          <p className="font-mono text-[11px] uppercase tracking-wide text-stone-500">Renewal months</p>
          <div className="mt-2 flex h-12 items-end gap-1">
            {data.renewalMonths.map((v, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full rounded-sm bg-stone-700" style={{ height: `${Math.max(2, (v / maxM) * 40)}px` }} title={`${v} employers`} />
                <span className="text-[10px] text-stone-400">{MONTHS[i]}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-4 text-sm">
          <p className="font-mono text-[11px] uppercase tracking-wide text-stone-500">Top brokers</p>
          <ul className="mt-1 space-y-0.5">
            {data.brokers.slice(0, 5).map((b) => (
              <li key={b.name} className="flex justify-between gap-2"><span className="truncate">{b.name}</span><span className="tabular-nums text-stone-500">{b.employers}</span></li>
            ))}
          </ul>
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left font-mono text-[11px] uppercase tracking-wide text-stone-500">
            <tr><th className="px-3 py-2">Largest employers</th><th className="px-3 py-2">Industry</th><th className="px-3 py-2 text-right">Persons covered</th><th className="px-3 py-2">Broker</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {data.top.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-1.5"><span className="font-medium">{r.sponsor}</span> <span className="text-xs text-stone-500">{r.city}, {r.state}</span></td>
                <td className="px-3 py-1.5 text-xs text-stone-600">{r.sector}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {r.c.length ? fmtInt(r.c.reduce((s, c) => s + (c.persons ?? 0), 0)) : <span title="Self-funded; participants from Form 5500">{fmtInt(r.participants)} <span className="text-[10px] text-stone-400">ASO</span></span>}
                </td>
                <td className="px-3 py-1.5 text-xs text-stone-600">{[...new Set(r.c.flatMap((c) => c.brokers))].slice(0, 2).join("; ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
