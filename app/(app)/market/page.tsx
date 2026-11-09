import Link from "next/link";
import { DataAsOf } from "@/components/DataAsOf";
import { NotIncluded } from "@/components/NotIncluded";
import type { Segment } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { availableYears, marketShare, rateActions } from "@/lib/marketdata/queries";
import { ShareBar, fmtInt, fmtMoneyM, fmtPct, fmtSignedPct, fmtUsd, lrClass, deltaClass, SEGMENT_LABEL } from "@/components/charts";
import { Empty } from "@/components/ui";
import { marketLargeGroup } from "@/lib/marketdata/largegroup";
import { MarketLargeGroup } from "@/components/LargeGroup";

export const dynamic = "force-dynamic";

const STATES = ["MA", "NH", "ME", "RI", "CT", "VT", "NY", "NJ", "PA"]; // quick picks; any state works via ?state=
const SEGMENTS: Segment[] = ["LARGE_GROUP", "SMALL_GROUP", "INDIVIDUAL"];

export default async function MarketPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const { financialYears } = await availableYears();
  if (!financialYears.length)
    return (
      <div className="space-y-5">
        <h1 className="h1">Market</h1>
        <DataAsOf datasets={["mlr", "urrt", "ma_chia", "state_snapshots"]} />
        <Empty title="Market data is loading">Public CMS filings import in the background after deploy. Check Settings → Market data for progress.</Empty>
      </div>
    );

  const state = /^[A-Z]{2}$/.test(sp.state ?? "") ? sp.state! : "MA";
  const segment = (SEGMENTS.includes(sp.segment as Segment) ? sp.segment : "LARGE_GROUP") as Segment;
  const year = financialYears.includes(Number(sp.year)) ? Number(sp.year) : financialYears[0];
  const [share, actions, lg] = await Promise.all([
    marketShare(session.workspaceId, state, segment, year),
    rateActions(session.workspaceId, state),
    segment === "LARGE_GROUP" ? marketLargeGroup(session.workspaceId, state) : null,
  ]);
  const qs = (o: Record<string, string | number>) => "?" + new URLSearchParams({ state, segment, year: String(year), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Market</h1>
        <DataAsOf datasets={["mlr", "urrt", "ma_chia", "state_snapshots"]} />
        <p className="text-sm text-stone-500">Who holds each market (fully insured and, where states publish it, self-insured), how it&apos;s moving, and what everyone filed for next year.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {STATES.map((s) => <Pill key={s} href={qs({ state: s })} active={s === state} label={s} />)}
        <span className="mx-1 text-stone-300">|</span>
        {SEGMENTS.map((s) => <Pill key={s} href={qs({ segment: s })} active={s === segment} label={SEGMENT_LABEL[s]} />)}
        <span className="mx-1 text-stone-300">|</span>
        {financialYears.slice(0, 5).map((y) => <Pill key={y} href={qs({ year: y })} active={y === year} label={String(y)} />)}
      </div>

      {lg && <MarketLargeGroup data={lg} state={state} />}

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{state} {SEGMENT_LABEL[segment].toLowerCase()}{segment === "LARGE_GROUP" ? ", fully insured only" : ""} · {year}</h2>
          <p className="text-sm text-stone-500">{fmtInt(share.total)} covered lives · {fmtMoneyM(share.totalPremium)} premium</p>
        </div>
        <p className="text-xs text-stone-500">Share of fully insured covered lives (CMS medical loss ratio reports). Self-funded employers are not in this data. Your competitors are highlighted.</p>
        {share.rows.length === 0 ? (
          <Empty title="No fully insured business reported for this selection" />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[11px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Carrier</th><th className="w-1/4 px-3 py-2">Share</th>
                  <th className="px-3 py-2 text-right">Lives</th><th className="px-3 py-2 text-right">YoY</th>
                  <th className="px-3 py-2 text-right">Premium</th><th className="px-3 py-2 text-right">PMPM</th><th className="px-3 py-2 text-right">Loss ratio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {share.rows.slice(0, 25).map((r) => (
                  <tr key={r.key}>
                    <td className="px-3 py-2">
                      {r.competitorId ? (
                        <Link href={`/competitors/${r.competitorId}?state=${state}`} className="font-medium hover:underline">{r.label}</Link>
                      ) : (
                        <span className="text-stone-600">{r.label}</span>
                      )}
                      {r.companies.length > 1 && <span className="ml-1 text-xs text-stone-400">({r.companies.length} entities)</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2"><ShareBar share={r.share} highlight={!!r.competitorId} /><span className="w-12 text-right tabular-nums">{fmtPct(r.share)}</span></div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.coveredLives)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${deltaClass(r.livesChange)}`}>{fmtSignedPct(r.livesChange)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoneyM(r.premium)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(r.premiumPmpm)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${lrClass(r.lossRatio)}`}>{fmtPct(r.lossRatio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {actions.planYear && actions.rows.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">{state} rate actions · plan year {actions.planYear}</h2>
          <p className="text-xs text-stone-500">Individual & small group rate filings. Rate change is enrollment-weighted across renewing plans; enrollment is as reported at filing.</p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[11px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Market</th><th className="px-3 py-2">Filing company</th>
                  <th className="px-3 py-2 text-right">Enrolled</th><th className="px-3 py-2 text-right">Rate chg</th>
                  <th className="px-3 py-2 text-right">Plans</th><th className="px-3 py-2 text-right">New / termed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {actions.rows.map((r) => (
                  <tr key={`${r.market}${r.company}`}>
                    <td className="whitespace-nowrap px-3 py-2">{r.market}</td>
                    <td className="px-3 py-2">
                      {r.competitorId ? <Link className="font-medium hover:underline" href={`/competitors/${r.competitorId}?state=${state}`}>{r.competitorName}</Link> : null}
                      <span className={`block text-xs ${r.competitorId ? "text-stone-400" : "text-stone-600"}`}>{r.company}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.enrollment)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.avgRateChange != null && r.avgRateChange > 0.1 ? "text-red-600" : ""}`}>{fmtSignedPct(r.avgRateChange)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.plans}</td>
                    <td className="px-3 py-2 text-right tabular-nums"><span className="text-emerald-700">+{r.newPlans}</span> / <span className="text-red-600">−{r.termed}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <NotIncluded items={[
        "Self-funded (ASO) employers: CMS medical loss ratio data covers fully insured business only. Massachusetts self-insured enrollment is shown from CHIA in the large-group panel; other states' self-funded markets aren't published.",
        "Carriers with under 100 covered lives in a state/segment are left out of share; legal entities with under $250K premium show no loss ratio (run-off books produce meaningless ratios).",
        "Loss ratios lag: the latest MLR year CMS has published, typically two years behind.",
        "Rate filings cover ACA individual and small group only. Large-group products and rates aren't publicly filed (except Rhode Island's large-group rate actions, shown above where available).",
        "Large-group state sources exist for MA, ME, RI and NH only; Connecticut and Vermont publish no comparable large-group carrier data.",
      ]} />
    </div>
  );
}

function Pill({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} className={`rounded-md px-2.5 py-1 ${active ? "bg-stone-900 text-white" : "border border-stone-200 bg-white text-stone-600 hover:border-stone-400"}`}>
      {label}
    </Link>
  );
}
