import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { issuerPatternFor } from "@/lib/marketdata/queries";
import { kindLabel, marketLabel, statusLabel } from "@/lib/serff/parse";
import { CompanyLogo } from "@/components/CompanyLogo";
import { RereadFiling } from "@/components/RereadFiling";

export const dynamic = "force-dynamic";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const pct = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const tone = (p: number | null) => (p == null ? "text-stone-300" : p < 90 ? "bg-red-50 text-red-700" : p < 98 ? "bg-amber-50 text-amber-800" : "text-stone-600");
const statusTone = (s: string | null) => (!s ? "bg-stone-100 text-stone-500" : /approv|certif|closed|accept/i.test(s) ? "bg-emerald-50 text-emerald-800" : /pend|open|review|object/i.test(s) ? "bg-amber-50 text-amber-800" : /withdr|disapp|reject/i.test(s) ? "bg-red-50 text-red-700" : "bg-stone-100 text-stone-600");
const sentences = (s: string) => s.split(/(?<=[.;])\s+(?=[A-Z])/).map((x) => x.trim()).filter(Boolean);

type Plan = { id?: string | null; name: string; metal?: string | null; network?: string | null; status?: string | null };

export default async function FilingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const f = await db.serffFiling.findUnique({ where: { id }, include: { access: true, crosswalk: true } });
  if (!f) notFound();
  const comps = session ? await db.competitor.findMany({ where: { workspaceId: session.workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } }) : [];
  const comp = f.company ? comps.find((c) => { try { return new RegExp(issuerPatternFor(c), "i").test(f.company!); } catch { return false; } }) ?? null : null;
  const d = (f.detail ?? {}) as { headline?: string | null; points?: string[]; plans?: Plan[]; networks?: string[]; objections?: string | null; description?: string | null; newPlanIds?: string[]; aiModel?: string | null; input?: string };
  const points = d.points?.length ? d.points : f.summary ? sentences(f.summary) : [];
  const status = statusLabel(f.disposition);

  // Plans with where their members came from (the crosswalk), and last year's plans that don't continue into this filing.
  const plans = d.plans ?? [];
  const planIds = new Set(plans.map((p) => p.id).filter(Boolean));
  const from = (pid: string | null | undefined) => (pid ? f.crosswalk.filter((c) => c.toPlan === pid) : []);
  const leaving = f.crosswalk.filter((c) => !c.toPlan || !planIds.has(c.toPlan));

  const networks = [...new Set(f.access.map((a) => a.network))];
  const hosp = f.access.filter((a) => /acute inpatient|hospital/i.test(a.specialty));
  const base = hosp.length ? hosp : f.access;
  const counties = [...new Set(base.map((a) => a.county))].sort();
  const members = (n: string, c: string) => base.find((a) => a.network === n && a.county === c)?.members ?? null;
  const facts: Array<[string, React.ReactNode]> = [
    ["Status", <span key="s" className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${statusTone(status)}`}>{status ?? "Unknown"}</span>],
    ["Filed", day(f.submitted)], ["Decided", day(f.dispositionAt)], ["Plan year", f.planYear],
    ["Market", marketLabel(f.market)], ["Kind", kindLabel(f.filingType)], ["Rate change", f.rateChange != null ? pct(f.rateChange) : null],
    ["Type of insurance", [f.toi, f.subToi].filter(Boolean).join(" / ") || null], ["SERFF", <span key="t" className="font-mono text-[11px]">{f.tracking}</span>],
  ];
  return (
    <div className="space-y-5">
      <div>
        <Link href="/reports/filings" className="text-xs text-stone-500 hover:underline">← State filings</Link>
        <div className="mt-2 flex items-center gap-2 text-sm text-stone-600">{comp ? <CompanyLogo id={comp.id} name={comp.name} size={20} /> : null}<span>{f.company}</span><span className="text-stone-300">·</span><span>{f.state}</span></div>
        <h1 className="h1 mt-1">{f.productName ?? f.tracking}</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0 space-y-5">
          <div className="card space-y-2 p-4">
            {d.headline && <p className="text-[15px] font-medium leading-snug">{d.headline}</p>}
            {points.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">{points.map((p, i) => <li key={i}>{p}</li>)}</ul> : <p className="text-sm text-stone-400">Not read yet.</p>}
          </div>
          {d.objections && <div className="card border-l-4 border-amber-400 p-4 text-sm"><div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-amber-800">Regulator objections</div>{d.objections}</div>}

          {plans.length > 0 && (
            <section className="space-y-2"><h2 className="font-semibold tracking-tight">Plans</h2>
              <div className="card overflow-x-auto"><table className="w-full text-xs">
                <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase text-stone-500"><tr><th className="px-3 py-2">Plan</th><th className="px-3 py-2">Metal</th>{plans.some((p) => p.network) && <th className="px-3 py-2">Network</th>}{f.crosswalk.length > 0 && <th className="px-3 py-2">Last year</th>}</tr></thead>
                <tbody className="divide-y divide-stone-100">{plans.map((p, i) => {
                  const prev = from(p.id);
                  return (
                    <tr key={i} className="align-top">
                      <td className="px-3 py-1.5"><div className="font-medium">{p.name}</div><div className="font-mono text-[10px] text-stone-400">{p.id}</div></td>
                      <td className="px-3 py-1.5">{p.metal}</td>
                      {plans.some((x) => x.network) && <td className="px-3 py-1.5">{p.network}</td>}
                      {f.crosswalk.length > 0 && <td className="px-3 py-1.5">{prev.length === 0 ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">New: no predecessor</span> : prev.length === 1 ? <span title={prev[0].reason ?? ""}>Renews <span className="font-mono text-[10px]">{prev[0].fromPlan}</span></span> : <span className="text-amber-800" title={prev.map((c) => `${c.fromPlan}: ${c.reason}`).join("\n")}>Absorbs {prev.length} plans <span className="font-mono text-[10px] text-stone-500">{prev.map((c) => c.fromPlan?.slice(-4)).join(", ")}</span></span>}</td>}
                    </tr>
                  );
                })}</tbody></table></div>
              {leaving.length > 0 && <p className="text-xs text-stone-600"><span className="font-medium">Not continuing as their own plan:</span> {leaving.map((c) => `${c.fromPlan} → ${c.toPlan ?? "discontinued"}`).join("; ")}</p>}
            </section>
          )}
          {!plans.length && f.crosswalk.length > 0 && (
            <section className="space-y-2"><h2 className="font-semibold tracking-tight">Plan crosswalk</h2>
              <div className="card overflow-x-auto"><table className="w-full text-xs"><thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase text-stone-500"><tr><th className="px-3 py-2">Last year</th><th className="px-3 py-2">This year</th><th className="px-3 py-2">Why</th></tr></thead>
                <tbody className="divide-y divide-stone-100">{f.crosswalk.map((c) => <tr key={c.id}><td className="px-3 py-1.5 font-mono">{c.fromPlan}</td><td className="px-3 py-1.5 font-mono">{c.toPlan ?? "—"}</td><td className="px-3 py-1.5">{c.reason}</td></tr>)}</tbody></table></div>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <dl className="card divide-y divide-stone-100 text-xs">
            {facts.filter(([, v]) => v != null && v !== "").map(([k, v]) => <div key={k} className="flex items-center justify-between gap-3 px-3 py-1.5"><dt className="text-stone-500">{k}</dt><dd className="text-right">{v}</dd></div>)}
          </dl>
          {(d.networks?.length ?? 0) > 0 && <div className="card p-3 text-xs"><div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-stone-500">Networks</div><ul className="space-y-0.5">{d.networks!.map((n) => <li key={n}>{n}</li>)}</ul></div>}
          <div className="space-y-1.5 text-[11px] text-stone-400">
            <RereadFiling id={f.id} canReread={typeof d.input === "string"} />
            {d.aiModel && <p>Read by {d.aiModel}.</p>}
            <details><summary className="cursor-pointer">Files read</summary><ul className="mt-1 space-y-0.5">{((f.files ?? []) as Array<{ name: string; kept: boolean }>).filter((x) => x.kept).map((x) => <li key={x.name} className="break-all">{x.name}</li>)}</ul></details>
          </div>
        </aside>
      </div>

      {d.description && <details className="card p-4 text-sm"><summary className="cursor-pointer font-medium">Filing description (as filed)</summary><p className="mt-2 whitespace-pre-wrap text-stone-700">{d.description}</p></details>}

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
            <p className="max-w-3xl text-xs text-stone-500">Share of members within the state&apos;s time-and-distance standard, worst county, for provider types where any network falls under 98%. {flagged.length ? "" : "Every network meets 98% or better for every provider type."} {same ? "All networks were tested against the same members (the carrier's book by county)." : ""}</p>
            {flagged.length > 0 && (
              <div className="card overflow-x-auto"><table className="w-full text-xs"><thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase text-stone-500"><tr><th className="px-3 py-2">Provider type</th>{networks.map((n) => <th key={n} className="px-3 py-2 text-right normal-case">{n}</th>)}</tr></thead>
                <tbody className="divide-y divide-stone-100">{flagged.map((sp) => <tr key={sp}><td className="px-3 py-1">{sp}</td>{networks.map((n) => { const w = worst(n, sp); return <td key={n} className={`px-3 py-1 text-right tabular-nums ${tone(w?.pct ?? null)}`} title={w ? `Worst county: ${w.county}` : undefined}>{w ? `${w.pct}%` : "—"}{w && w.pct! < 98 ? <span className="ml-1 text-[10px] text-stone-400">{w.county}</span> : null}</td>; })}</tr>)}</tbody></table></div>
            )}
            <details className="card p-3 text-xs">
              <summary className="cursor-pointer text-stone-600">Members tested by county ({counties.reduce((t, c) => t + (members(cols[0], c) ?? 0), 0).toLocaleString()} total)</summary>
              <table className="mt-2 w-full"><thead className="text-left font-mono text-[10px] uppercase text-stone-500"><tr><th className="py-1">County</th>{cols.map((n) => <th key={n} className="py-1 text-right normal-case">{same ? "Members" : n}</th>)}</tr></thead>
                <tbody className="divide-y divide-stone-100">{counties.map((c) => <tr key={c}><td className="py-0.5">{c}</td>{cols.map((n) => <td key={n} className="py-0.5 text-right tabular-nums">{members(n, c)?.toLocaleString() ?? "—"}</td>)}</tr>)}</tbody></table>
            </details>
          </section>
        );
      })()}
    </div>
  );
}
