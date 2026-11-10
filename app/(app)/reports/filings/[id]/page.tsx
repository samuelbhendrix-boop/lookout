import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
const tone = (p: number | null) => (p == null ? "text-stone-300" : p < 90 ? "bg-red-50 text-red-700" : p < 98 ? "bg-amber-50 text-amber-800" : "text-stone-600");

export default async function FilingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await db.serffFiling.findUnique({ where: { id }, include: { access: true, crosswalk: true } });
  if (!f) notFound();
  const d = (f.detail ?? {}) as { plans?: Array<{ id?: string | null; name: string; metal?: string | null; network?: string | null; status?: string | null }>; networks?: string[]; objections?: string | null; description?: string | null };
  const networks = [...new Set(f.access.map((a) => a.network))];
  // Members per network and county come from the hospital-access rows (every member appears once per provider type).
  const hosp = f.access.filter((a) => /acute inpatient|hospital/i.test(a.specialty));
  const base = hosp.length ? hosp : f.access;
  const counties = [...new Set(base.map((a) => a.county))].sort();
  const members = (n: string, c: string) => base.find((a) => a.network === n && a.county === c)?.members ?? null;
  return (
    <div className="space-y-5">
      <div>
        <Link href="/reports/filings" className="text-xs text-stone-500 hover:underline">← State filings</Link>
        <h1 className="h1 mt-1">{f.productName ?? f.tracking}</h1>
        <p className="text-sm text-stone-500">{f.company} · {f.state} · {f.market}{f.filingType ? ` · ${f.filingType}` : ""} · SERFF {f.tracking}</p>
        <p className="text-xs text-stone-400">{[f.toi, f.subToi].filter(Boolean).join(" / ")}{f.planYear ? ` · plan year ${f.planYear}` : ""} · submitted {day(f.submitted)} · {f.disposition ?? "status unknown"} {f.dispositionAt ? day(f.dispositionAt) : ""}{f.newProduct ? " · new product" : ""}</p>
      </div>
      {f.summary && <div className="card p-4 text-sm">{f.summary}</div>}
      {d.objections && <div className="card border-l-4 border-amber-400 p-4 text-sm"><span className="font-medium">Regulator objections: </span>{d.objections}</div>}
      {d.description && <details className="card p-4 text-sm"><summary className="cursor-pointer font-medium">Filing description (as filed)</summary><p className="mt-2 whitespace-pre-wrap text-stone-700">{d.description}</p></details>}
      {d.plans && d.plans.length > 0 && (
        <section className="space-y-2"><h2 className="font-semibold tracking-tight">Plans</h2>
          <div className="card overflow-x-auto"><table className="w-full text-xs"><thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase text-stone-500"><tr><th className="px-3 py-2">Plan</th><th className="px-3 py-2">ID</th><th className="px-3 py-2">Metal</th><th className="px-3 py-2">Network</th><th className="px-3 py-2">Status</th></tr></thead>
            <tbody className="divide-y divide-stone-100">{d.plans.map((p, i) => <tr key={i}><td className="px-3 py-1.5 font-medium">{p.name}</td><td className="px-3 py-1.5 font-mono text-[10px]">{p.id}</td><td className="px-3 py-1.5">{p.metal}</td><td className="px-3 py-1.5">{p.network}</td><td className="px-3 py-1.5">{p.status}</td></tr>)}</tbody></table></div>
        </section>
      )}
      {f.crosswalk.length > 0 && (
        <section className="space-y-2"><h2 className="font-semibold tracking-tight">Plan crosswalk: where this year&apos;s members go next year</h2>
          <div className="card overflow-x-auto"><table className="w-full text-xs"><thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase text-stone-500"><tr><th className="px-3 py-2">From plan</th><th className="px-3 py-2">To plan</th><th className="px-3 py-2">Why</th></tr></thead>
            <tbody className="divide-y divide-stone-100">{f.crosswalk.map((c) => <tr key={c.id} className={/discontinu|terminat|not renew/i.test(c.reason ?? "") ? "bg-red-50" : /different plan|mapp/i.test(c.reason ?? "") ? "bg-amber-50" : ""}><td className="px-3 py-1.5 font-mono">{c.fromPlan}</td><td className="px-3 py-1.5 font-mono">{c.toPlan ?? "—"}</td><td className="px-3 py-1.5">{c.reason}</td></tr>)}</tbody></table></div>
          <p className="text-[10px] text-stone-400">Amber: members moved to a different plan; red: plan discontinued.</p>
        </section>
      )}
      {networks.length > 0 && (() => {
        // Carriers usually test every network against the same population (their enrolled members by county), so the
        // member counts are the carrier's book, not each network's. Show them once when they're identical.
        const same = networks.every((n) => counties.every((c) => members(n, c) === members(networks[0], c)));
        const cols = same ? [networks[0]] : networks;
        const specs = [...new Set(f.access.map((a) => a.specialty))];
        const worst = (n: string, sp: string) => { const xs = f.access.filter((a) => a.network === n && a.specialty === sp && a.pct != null); return xs.length ? xs.reduce((m, a) => (a.pct! < m.pct! ? a : m)) : null; };
        const flagged = specs.filter((sp) => networks.some((n) => (worst(n, sp)?.pct ?? 100) < 98));
        return (
          <section className="space-y-2">
            <h2 className="font-semibold tracking-tight">Network adequacy</h2>
            <p className="max-w-3xl text-xs text-stone-500">From the geo-access analyses filed for each network ({networks.join(", ")}): the share of members within the state&apos;s time-and-distance standard of each provider type, worst county shown. {same ? "Every network was tested against the same members (the carrier's enrolled book by county), so the counts below are the carrier's members, not each network's." : "Member counts differ by network."}</p>
            {flagged.length > 0 && (
              <div className="card overflow-x-auto"><table className="w-full text-xs"><thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase text-stone-500"><tr><th className="px-3 py-2">Provider type (any network under 98%)</th>{networks.map((n) => <th key={n} className="px-3 py-2 text-right normal-case">{n}</th>)}</tr></thead>
                <tbody className="divide-y divide-stone-100">{flagged.map((sp) => <tr key={sp}><td className="px-3 py-1">{sp}</td>{networks.map((n) => { const w = worst(n, sp); return <td key={n} className={`px-3 py-1 text-right tabular-nums ${tone(w?.pct ?? null)}`} title={w ? `Worst county: ${w.county}` : undefined}>{w ? `${w.pct}%` : "—"}{w && w.pct! < 98 ? <span className="ml-1 text-[10px] text-stone-400">{w.county}</span> : null}</td>; })}</tr>)}</tbody></table></div>
            )}
            <div className="card overflow-x-auto"><table className="w-full text-xs"><thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase text-stone-500"><tr><th className="px-3 py-2">County</th>{cols.map((n) => <th key={n} className="px-3 py-2 text-right normal-case">{same ? "Members tested" : n}</th>)}</tr></thead>
              <tbody className="divide-y divide-stone-100">
                {counties.map((c) => <tr key={c}><td className="px-3 py-1">{c}</td>{cols.map((n) => <td key={n} className="px-3 py-1 text-right tabular-nums">{members(n, c)?.toLocaleString() ?? "—"}</td>)}</tr>)}
                <tr className="font-medium"><td className="px-3 py-1">Total</td>{cols.map((n) => <td key={n} className="px-3 py-1 text-right tabular-nums">{counties.reduce((t, c) => t + (members(n, c) ?? 0), 0).toLocaleString()}</td>)}</tr>
              </tbody></table></div>
          </section>
        );
      })()}
      <p className="text-[10px] text-stone-400">Files read: {((f.files ?? []) as Array<{ name: string; kept: boolean }>).filter((x) => x.kept).map((x) => x.name).join(", ")}</p>
    </div>
  );
}
