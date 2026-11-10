import Link from "next/link";
import { db } from "@/lib/db";
import { SerffUpload } from "@/components/SerffUpload";
import { FilterBar } from "@/components/FilterBar";
import { Suspense } from "react";

export const dynamic = "force-dynamic";
export const metadata = { title: "SERFF filings · Reports" };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
const pct = (v: number | null) => (v == null ? "" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);

export default async function FilingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const all = await db.serffFiling.findMany({ orderBy: [{ submitted: "desc" }, { createdAt: "desc" }], include: { _count: { select: { access: true, crosswalk: true } } } });
  const states = [...new Set(all.map((f) => f.state).filter(Boolean) as string[])].sort();
  const companies = [...new Set(all.map((f) => f.company).filter(Boolean) as string[])].sort();
  const markets = [...new Set(all.map((f) => f.market).filter(Boolean) as string[])].sort();
  const rows = all.filter((f) => (!sp.state || f.state === sp.state) && (!sp.company || f.company === sp.company) && (!sp.market || f.market === sp.market) && (!sp.new || f.newProduct));
  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">State filings (SERFF)</h1>
        <p className="max-w-3xl text-sm text-stone-500">Form, rate and plan-binder filings you&apos;ve added from SERFF Filing Access (it doesn&apos;t allow automated download). Each is read for its products, plans, rate change, networks and what the regulator objected to; network-adequacy files add members by network and county, and plan crosswalks show which plans renew, merge or close.</p>
      </div>
      <SerffUpload />
      {all.length > 0 && (
        <Suspense>
          <FilterBar filters={[
            { key: "state", label: "State", options: states.map((s) => ({ value: s, label: s })) },
            { key: "company", label: "Company", options: companies.map((s) => ({ value: s, label: s })) },
            { key: "market", label: "Market", options: markets.map((s) => ({ value: s, label: s })) },
            { key: "new", label: "Show", options: [{ value: "1", label: "New products only" }] },
          ]} />
        </Suspense>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Submitted</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Company</th><th className="px-3 py-2">Filing</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">What it is</th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((f) => (
              <tr key={f.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-stone-500">{day(f.submitted)}</td>
                <td className="px-3 py-2 text-xs">{f.state}</td>
                <td className="max-w-[180px] px-3 py-2 text-xs">{f.company}</td>
                <td className="max-w-[220px] px-3 py-2"><Link href={`/reports/filings/${f.id}`} className="font-medium hover:underline">{f.productName ?? f.tracking}</Link><div className="text-[10px] text-stone-400">{f.tracking}{f.subToi ? ` · ${f.subToi}` : f.toi ? ` · ${f.toi}` : ""}</div></td>
                <td className="px-3 py-2 text-xs">{f.market}{f.filingType ? <div className="text-stone-500">{f.filingType}</div> : null}{f.newProduct ? <span className="mt-0.5 inline-block rounded bg-emerald-50 px-1 text-[10px] font-medium text-emerald-800">New product</span> : null}</td>
                <td className="px-3 py-2 text-xs">{f.disposition}{f.rateChange != null ? <div className="tabular-nums">{pct(f.rateChange)}</div> : null}<div className="text-stone-400">{day(f.dispositionAt)}</div></td>
                <td className="max-w-[420px] px-3 py-2 text-xs text-stone-600">{f.summary ?? <span className="text-stone-400">Summary pending (needs the AI key)</span>}{(f._count.access > 0 || f._count.crosswalk > 0) && <div className="mt-1 text-[10px] text-stone-400">{f._count.access ? `${f._count.access} network-access rows` : ""}{f._count.access && f._count.crosswalk ? " · " : ""}{f._count.crosswalk ? `${f._count.crosswalk} plan crosswalk rows` : ""}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="px-3 py-4 text-sm text-stone-500">{all.length ? "No filings match these filters." : "No filings added yet."}</p>}
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
