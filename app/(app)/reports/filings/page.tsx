import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { issuerPatternFor } from "@/lib/marketdata/queries";
import { kindLabel, marketLabel, statusLabel } from "@/lib/serff/parse";
import { SerffUpload } from "@/components/SerffUpload";
import { FilterBar } from "@/components/FilterBar";
import { CompanyLogo } from "@/components/CompanyLogo";

export const dynamic = "force-dynamic";
export const metadata = { title: "State filings · Reports" };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const pct = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const entity = (c: string | null) => (c ?? "Unknown").replace(/,?\s+(Inc\.?|Company|Corporation|Corp\.?)$/i, "").replace(/ Health Care( of New England)?$/, "$1").replace(/ Insurance Company$/, "").replace(/^Blue Cross and Blue Shield of Massachusetts( HMO Blue)?/, "BCBS MA$1").replace(/ Health Plan$/, "").trim();
const firstSentence = (s: string) => { const m = /^(.{40,220}?[.;])\s/.exec(s); return m ? m[1] : s.slice(0, 200) + (s.length > 200 ? "…" : ""); };
const statusTone = (s: string | null) => (!s ? "bg-stone-100 text-stone-500" : /approv|certif|closed|accept/i.test(s) ? "bg-emerald-50 text-emerald-800" : /pend|open|review|object/i.test(s) ? "bg-amber-50 text-amber-800" : /withdr|disapp|reject/i.test(s) ? "bg-red-50 text-red-700" : "bg-stone-100 text-stone-600");

export default async function FilingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  const [all, comps] = await Promise.all([
    db.serffFiling.findMany({ orderBy: [{ submitted: "desc" }, { createdAt: "desc" }], include: { _count: { select: { access: true, crosswalk: true } } } }),
    session ? db.competitor.findMany({ where: { workspaceId: session.workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } }) : [],
  ]);
  const compOf = (company: string | null) => (company ? comps.find((c) => { try { return new RegExp(issuerPatternFor(c), "i").test(company); } catch { return false; } }) ?? null : null);
  const items = all.map((f) => {
    const d = (f.detail ?? {}) as { headline?: string | null; points?: string[]; objections?: string | null; newPlanIds?: string[]; input?: string };
    const comp = compOf(f.company);
    return { f, d, comp, carrier: comp?.name ?? f.company ?? "Unknown", market: marketLabel(f.market), status: statusLabel(f.disposition), kind: kindLabel(f.filingType) };
  });
  const opts = (xs: Array<string | null>) => [...new Set(xs.filter(Boolean) as string[])].sort().map((v) => ({ value: v, label: v }));
  const rows = items.filter((x) => (!sp.state || x.f.state === sp.state) && (!sp.carrier || x.carrier === sp.carrier) && (!sp.market || x.market === sp.market) && (!sp.new || x.f.newProduct));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h1">State filings</h1>
          <p className="text-sm text-stone-500">Rate, form and plan-binder filings added from SERFF, read for what changed, plans, networks and regulator pushback.</p>
        </div>
        <SerffUpload />
      </div>
      {all.length > 0 && (
        <Suspense>
          <FilterBar filters={[
            { key: "carrier", label: "Carrier", options: opts(items.map((x) => x.carrier)) },
            { key: "state", label: "State", options: opts(items.map((x) => x.f.state)) },
            { key: "market", label: "Market", options: opts(items.map((x) => x.market)) },
            { key: "new", label: "Show", options: [{ value: "1", label: "New products or plans" }] },
          ]} />
        </Suspense>
      )}
      <div className="card divide-y divide-stone-100">
        {rows.map(({ f, d, comp, carrier, market, status, kind }) => {
          const take = d.headline ?? (d.points?.[0] ?? (f.summary ? firstSentence(f.summary) : null));
          return (
            <Link key={f.id} href={`/reports/filings/${f.id}`} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 py-3 hover:bg-stone-50 md:grid-cols-[250px_1fr_110px]">
              <div className="flex min-w-0 items-start gap-2">
                {comp ? <CompanyLogo id={comp.id} name={comp.name} size={20} className="mt-0.5" /> : <span className="mt-0.5 inline-block h-5 w-5 shrink-0 rounded bg-stone-100" />}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" title={f.company ?? ""}>{entity(f.company)}</div>
                  <div className="truncate text-[11px] text-stone-500">{[f.state, market, kind, f.planYear].filter(Boolean).join(" · ")}</div>
                </div>
              </div>
              <div className="col-span-2 min-w-0 md:col-span-1 md:row-start-1 md:col-start-2">
                <div className="truncate text-sm">{f.productName ?? f.tracking}</div>
                <div className="text-xs text-stone-600">{take ?? <span className="text-stone-400">Not read yet</span>}</div>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                  {f.newProduct && <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800">{d.newPlanIds?.length ? `${d.newPlanIds.length} new plan${d.newPlanIds.length === 1 ? "" : "s"}` : "New product"}</span>}
                  {f.rateChange != null && <span className="rounded bg-stone-100 px-1.5 py-0.5 tabular-nums text-stone-700">Rate {pct(f.rateChange)}</span>}
                  {d.objections && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">Objections</span>}
                  {f._count.crosswalk > 0 && <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-600">Crosswalk</span>}
                  {f._count.access > 0 && <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-600">Network adequacy</span>}
                </div>
              </div>
              <div className="row-start-1 text-right md:col-start-3">
                <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${statusTone(status)}`}>{status ?? "Unknown"}</span>
                <div className="mt-1 text-[10px] tabular-nums text-stone-400">Filed {day(f.submitted) ?? "—"}</div>
              </div>
            </Link>
          );
        })}
        {!rows.length && <p className="px-4 py-6 text-sm text-stone-500">{all.length ? "No filings match these filters." : "No filings added yet. Use “Add filings” to upload a filing folder downloaded from SERFF Filing Access."}</p>}
      </div>
      <details className="text-xs text-stone-500">
        <summary className="cursor-pointer">Which SERFF type-of-insurance codes to search</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li><b>H16G</b> Group Health – Major Medical (insurer-licensed: Aetna, Cigna, Anthem PPO). Large group only: H16G.002A–D (PPO, POS, Other, EPO); any size: H16G.001A–D.</li>
          <li><b>HOrg02G</b> Group Health Organizations (HMO-licensed: Harvard Pilgrim, Tufts HMO, HMO Blue, MGB, HNE, Fallon). Large group only: HOrg02G.003A–D (PPO, POS, HMO, Other).</li>
          <li><b>H12.004</b> Stop Loss – Self-Funded Health Plan: shows who is selling level-funded and self-funded programs.</li>
          <li>Individual (H16I.005, HOrg02I) and small group (H16G.003, HOrg02G.004) are also in CMS&apos;s rate filings, but their binders add networks, adequacy and crosswalks.</li>
        </ul>
      </details>
    </div>
  );
}
