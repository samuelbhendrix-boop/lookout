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
import { colorMap, hasColor, Legend, LineChart, OTHER, StackedShares } from "@/components/viz";
import { rankCompetitors } from "@/lib/homecharts";
import { crossCheck } from "@/lib/marketdata/crosscheck";

/** Known explanations for cross-check gaps over 15%, found by comparing the two sources carrier by carrier. */
const WHY: Record<string, string> = {
  "MA|LARGE_GROUP": "Almost all of it is BCBSMA: 669K fully insured lives in its loss-ratio filings vs 330K in CHIA (other carriers match within a few %). CHIA counts some BCBSMA accounts as self-insured (likely minimum-premium funding) and only MA residents; MLR counts MA-sitused policies wherever members live.",
  "ME|SMALL_GROUP": "Mostly Harvard Pilgrim: 11K small-group lives in its Maine loss-ratio filing vs 30K in its Maine rate filing. The rate filing's count is at filing and may include groups reported under another state in MLR.",
  "NH|SMALL_GROUP": "Rate-filing enrollment is a snapshot at filing (early in the year), MLR is year-end; NH small group also shifted to association and level-funded plans that leave the fully insured count.",
  "RI|LARGE_GROUP": "OHIC's rate review only covers the carriers and products it reviews, at filing; MLR counts every fully insured large-group policy sitused in RI.",
  "NH|LARGE_GROUP": "The NH figure is estimated from published market shares, not a direct count.",
};

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
  // Share for the selected state × segment: this year in full, and how it moved over the years on file.
  const checks = await crossCheck(year);
  const ranked = await rankCompetitors(session.workspaceId);
  const color = colorMap(ranked);
  const years = [...financialYears].sort((a, b) => a - b).slice(-5);
  const history = await Promise.all(years.map(async (y) => ({ y, share: y === year ? share : await marketShare(session.workspaceId, state, segment, y) })));
  const keyOf = (r: { key: string; competitorId: string | null }) => r.competitorId ?? r.key;
  const colorOf = (r: { competitorId: string | null }) => (hasColor(ranked, r.competitorId ?? undefined) ? color(r.competitorId!) : OTHER);
  const partsOf = (rows: typeof share.rows) => rows.map((r) => ({ name: r.label, key: keyOf(r), value: r.coveredLives }));
  const colorByKey = new Map(history.flatMap((h) => h.share.rows.map((r) => [keyOf(r), colorOf(r)] as const)));
  const flag = checks.find((c) => c.state === state && c.segment === segment && Math.abs(c.diff) > 0.15);
  // Lines: every carrier that ever held 3%+ here; colored competitors in color, others gray.
  const lineKeys = [...new Set(history.flatMap((h) => h.share.rows.filter((r) => r.share >= 0.03).map(keyOf)))];
  const shareSeries = lineKeys.map((k) => {
    const label = history.flatMap((h) => h.share.rows).find((r) => keyOf(r) === k)!.label;
    const comp = history.flatMap((h) => h.share.rows).find((r) => keyOf(r) === k)?.competitorId ?? null;
    return { name: label, competitorId: hasColor(ranked, comp ?? undefined) ? comp! : `__gray:${k}`, points: history.map((h) => ({ x: String(h.y), y: h.share.rows.find((r) => keyOf(r) === k)?.share ?? null })) };
  }).sort((a, b) => (b.points.at(-1)?.y ?? 0) - (a.points.at(-1)?.y ?? 0));
  const lineColor = (id?: string) => (id?.startsWith("__gray:") ? "#a8a29e" : color(id));
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

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Market share · {state} {SEGMENT_LABEL[segment].toLowerCase()} · {year}</h2>
          <p className="text-xs text-stone-500">Share of fully insured covered lives; the bar sums to 100%. {fmtInt(share.total)} lives.</p>
        </div>
        {share.rows.length > 0 && (
          <div className="card space-y-3 p-4">
            <StackedShares rows={[{ label: "", total: share.total, parts: partsOf(share.rows) }]} color={(k) => colorByKey.get(k ?? "") ?? OTHER} fmtTotal={(v) => Math.round(v).toLocaleString("en-US")} tall />
            <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {share.rows.map((r) => (
                <li key={r.key} className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: colorOf(r) }} />
                  <span className={`min-w-0 flex-1 truncate ${r.competitorId ? "font-medium" : "text-stone-600"}`} title={r.label}>{r.label}</span>
                  <span className="tabular-nums">{fmtPct(r.share)}</span>
                  <span className={`w-14 text-right text-xs tabular-nums ${deltaClass(r.livesChange)}`} title="Change in covered lives vs prior year">{fmtSignedPct(r.livesChange, 0)}</span>
                </li>
              ))}
            </ul>
            {flag && <p className="text-xs text-amber-700">⚠ This total is {fmtSignedPct(flag.diff, 0)} vs {flag.source} ({fmtInt(flag.value)}). {WHY[`${state}|${segment}`] ?? ""}</p>}
          </div>
        )}

        {history.filter((h) => h.share.total > 0).length >= 2 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <p className="mb-2 text-sm font-semibold">Share by year · each bar 100%</p>
              <StackedShares rows={history.filter((h) => h.share.total > 0).map((h) => ({ label: String(h.y), total: h.share.total, sub: "lives", parts: partsOf(h.share.rows) }))} color={(k) => colorByKey.get(k ?? "") ?? OTHER} fmtTotal={(v) => Math.round(v).toLocaleString("en-US")} />
            </div>
            <div className="card p-4">
              <p className="mb-2 text-sm font-semibold">Share trend · carriers that held 3%+</p>
              <LineChart series={shareSeries} x={history.map((h) => String(h.y))} color={lineColor} fmt={(v) => `${(v * 100).toFixed(0)}%`} yZero height={230} solid />
              <Legend items={shareSeries.map((s) => ({ name: s.name, color: lineColor(s.competitorId) }))} />
              <p className="mt-1 text-[11px] text-stone-500">Gray lines: carriers outside your top eight competitors or not tracked.</p>
            </div>
          </div>
        )}

        <details className="card" open={checks.some((c) => Math.abs(c.diff) > 0.15)}>
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium">Cross-check: market totals vs an independent count ({checks.filter((c) => Math.abs(c.diff) <= 0.15).length} of {checks.length} within 15%)</summary>
          <div className="overflow-x-auto border-t border-stone-100">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">State</th><th className="px-3 py-2">Segment</th><th className="px-3 py-2 text-right">CMS loss-ratio lives ({year})</th><th className="px-3 py-2 text-right">Independent count</th><th className="px-3 py-2 text-right">Difference</th><th className="px-3 py-2">Source · period</th><th className="px-3 py-2">Why it differs</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {checks.map((c) => {
                  const off = Math.abs(c.diff) > 0.15;
                  return (
                    <tr key={`${c.state}${c.segment}`} className="align-top">
                      <td className="px-3 py-1.5">{c.state}</td><td className="px-3 py-1.5">{SEGMENT_LABEL[c.segment]}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(c.mlr)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(c.value)}</td>
                      <td className={`px-3 py-1.5 text-right font-medium tabular-nums ${off ? "text-red-600" : "text-emerald-700"}`}>{fmtSignedPct(c.diff, 0)}</td>
                      <td className="px-3 py-1.5 text-xs text-stone-600">{c.source} · {c.period}</td>
                      <td className="max-w-[360px] px-3 py-1.5 text-xs text-stone-500">{off ? WHY[`${c.state}|${c.segment}`] ?? "Not yet explained." : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11px] text-stone-500">No independent count exists for Connecticut or Vermont large group. Differences under 15% are timing and scope (year-end vs filing date, residents vs policy situs).</p>
          </div>
        </details>
      </section>

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
