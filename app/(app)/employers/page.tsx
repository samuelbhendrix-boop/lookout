import Link from "next/link";
import { NotIncluded } from "@/components/NotIncluded";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { listEmployers } from "@/lib/marketdata/employers";
import { fmtInt, fmtMoneyM } from "@/components/charts";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function EmployersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const [competitors, any] = await Promise.all([
    db.competitor.findMany({ where: { workspaceId: session.workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.employerPlan.count(),
  ]);
  const minParticipants = Number(sp.min) || 100;
  const rows = any
    ? await listEmployers(session.workspaceId, { state: sp.state || undefined, competitorId: sp.competitorId || undefined, funding: sp.funding || undefined, q: sp.q, minParticipants, limit: 300 })
    : [];
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Employers</h1>
          <p className="text-sm text-stone-500">Employer health plans from DOL Form 5500 filings — who insures them, through which broker, and when they renew.</p>
        </div>
        <div className="flex gap-2">
          <Link className="btn-ghost" href="/transparency">Transparency files</Link>
          <a className="btn-ghost" href={`/api/v1/employers?format=csv&${qs}`}>Export CSV</a>
        </div>
      </div>

      <form method="GET" className="card grid grid-cols-2 gap-2 p-3 sm:grid-cols-6">
        <input className="input col-span-2" name="q" placeholder="Employer or plan name" defaultValue={sp.q} />
        <select className="input" name="state" defaultValue={sp.state ?? ""}>
          <option value="">All NE states</option>
          {["MA", "NH", "ME", "RI", "CT", "VT"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" name="competitorId" defaultValue={sp.competitorId ?? ""}>
          <option value="">Any carrier</option>
          {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input" name="funding" defaultValue={sp.funding ?? ""}>
          <option value="">Any funding</option>
          <option value="insured">Insured</option>
          <option value="self-funded">Self-funded</option>
          <option value="mixed">Mixed</option>
        </select>
        <div className="flex gap-2">
          <select className="input" name="min" defaultValue={String(minParticipants)}>
            {[100, 250, 500, 1000, 5000].map((n) => <option key={n} value={n}>{n}+ lives</option>)}
          </select>
          <button className="btn">Go</button>
        </div>
      </form>

      {!any ? (
        <Empty title="Employer data is loading">Form 5500 filings import in the background after deploy (Settings → Market data).</Empty>
      ) : rows.length === 0 ? (
        <Empty title="No employers match" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 text-left font-mono text-[11px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Employer</th><th className="px-3 py-2">Industry</th><th className="px-3 py-2 text-right">Participants</th>
                <th className="px-3 py-2">Funding</th><th className="px-3 py-2">Medical carrier</th><th className="px-3 py-2">Broker</th><th className="px-3 py-2">Renews</th><th className="px-3 py-2 text-right">Premium</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2">
                    <p className="font-medium">{r.sponsor}</p>
                    <p className="text-xs text-stone-500">{r.city}, {r.state} · plan year {r.planYearBegin.getUTCFullYear()}</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-stone-600">{r.sector}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.participants)}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.funding}

                    {r.stopLoss.length > 0 && <span className="block text-stone-500">stop-loss: {r.stopLoss.join(", ")}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.carriers.length === 0 && r.administrators.length === 0 && <span className="text-stone-400">not disclosed</span>}
                    {r.carriers.length === 0 && r.administrators.map((a, i) => (
                      <span key={`a${i}`} className="block" title="Found in the carrier's Transparency in Coverage index">
                        {a.competitorId ? <Link className="font-medium hover:underline" href={`/competitors/${a.competitorId}`}>{a.competitorName}</Link> : a.carrier}
                        <span className="ml-1 rounded bg-stone-100 px-1 text-[10px] text-stone-500">{/third/i.test(a.entityType ?? "") ? "TPA" : "TiC"}</span>
                      </span>
                    ))}
                    {r.carriers.map((c, i) => (
                      <span key={i} className="block">{c.competitorId ? <Link className="font-medium hover:underline" href={`/competitors/${c.competitorId}`}>{c.competitorName}</Link> : c.carrier}{c.persons ? <span className="text-stone-400"> · {fmtInt(c.persons)}</span> : null}</span>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-xs text-stone-600">{[...new Set(r.carriers.flatMap((c) => c.brokers))].slice(0, 2).join("; ") || "—"}</td>
                  <td className="px-3 py-2 text-xs">{[...new Set(r.carriers.map((c) => c.renewalMonth).filter(Boolean))].map((m) => MONTHS[m! - 1]).join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoneyM(r.carriers.reduce((s, c) => s + (c.premium ?? 0), 0) || null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-[11px] text-stone-400">
            Source: <a className="underline" href="https://www.dol.gov/agencies/ebsa/about-ebsa/our-activities/public-disclosure/foia/form-5500-datasets" target="_blank" rel="noopener noreferrer">DOL Form 5500 + Schedule A</a>.
            Plans with 100+ participants; latest filing per plan. Where the 5500 doesn&apos;t name a carrier, the administrator comes from carriers&apos;
            <Link className="underline" href="/transparency"> Transparency in Coverage files</Link> (tagged TPA/TiC), matched by employer EIN. Employer location is the plan sponsor&apos;s mailing address, so national employers appear with all their participants.
          </p>
        </div>
      )}
      <NotIncluded items={[
        "Government and church plans (cities, towns, states, school districts, public universities, dioceses) don't file Form 5500, so they never appear here — a large share of New England's biggest employers.",
        "Insured plans with under 100 participants are exempt from Form 5500; this list starts at 100.",
        "Self-funded plans name no carrier on Schedule A. The administrator is filled in only where Cigna, UnitedHealthcare or Harvard Pilgrim list the employer's EIN in their transparency files; BCBSMA, Aetna, Anthem, Tufts and others can't be checked yet.",
        "Only each plan's most recent filing is shown; filings arrive 7–10 months after the plan year ends, so the newest data is roughly a year old.",
        "Location is the sponsor's mailing address; national employers headquartered elsewhere are missing even if they have large New England workforces.",
        "The page shows the 300 largest matches; CSV export returns up to 2,000.",
      ]} />
    </div>
  );
}
