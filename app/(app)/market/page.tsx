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
import { Legend, LineChart, OTHER, StackedShares } from "@/components/viz";
import { chartColors } from "@/lib/us";
import { asoMethodCheck, BASIS, selfFunded, sourceLabel, SELF_FUNDED_STATES } from "@/lib/marketdata/selffunded";
import { crossCheck } from "@/lib/marketdata/crosscheck";
import { CoverageCheck } from "@/components/CoverageCheck";

/** Known explanations for cross-check gaps over 15%, found by comparing the two sources carrier by carrier. */
const WHY: Record<string, string> = {
  "MA|LARGE_GROUP": "Almost all of it is BCBSMA, and both numbers are real: its federal loss-ratio filings report 669K fully insured large-group lives across two legal entities (HMO Blue, Inc. 402K and Blue Cross and Blue Shield of Massachusetts, Inc. 267K), while CHIA counts about 330K. The two sources define the population differently: CHIA counts only Massachusetts residents and classifies some BCBSMA employer accounts (likely minimum-premium or other partially self-funded arrangements) as self-insured, whereas the federal filing counts every member of a policy written in Massachusetts as fully insured. Other carriers match CHIA within a few percent. Use the federal number for premium and loss-ratio comparisons, and CHIA's for Massachusetts membership.",
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
  // "SELF_FUNDED" shows the self-funded (ASO) view where a state publishes it; the rest of the page uses large group.
  const selfMode = sp.segment === "SELF_FUNDED";
  const segment = (SEGMENTS.includes(sp.segment as Segment) ? sp.segment : "LARGE_GROUP") as Segment;
  const year = financialYears.includes(Number(sp.year)) ? Number(sp.year) : financialYears[0];
  const [share, actions, lg] = await Promise.all([
    marketShare(session.workspaceId, state, segment, year),
    rateActions(session.workspaceId, state),
    segment === "LARGE_GROUP" ? marketLargeGroup(session.workspaceId, state) : null,
  ]);
  // Share for the selected state × segment: this year in full, and how it moved over the years on file.
  const checks = await crossCheck(year);
  const { color, us, has } = await chartColors(session.workspaceId);
  const sf = selfMode && SELF_FUNDED_STATES.includes(state) ? (await selfFunded(session.workspaceId, [state]))[0] ?? null : null;
  const method = selfMode ? await asoMethodCheck(session.workspaceId) : null;
  const years = [...financialYears].sort((a, b) => a - b).slice(-5);
  const history = await Promise.all(years.map(async (y) => ({ y, share: y === year ? share : await marketShare(session.workspaceId, state, segment, y) })));
  const keyOf = (r: { key: string; competitorId: string | null }) => r.competitorId ?? r.key;
  const colorOf = (r: { competitorId: string | null }) => (has(r.competitorId ?? undefined) ? color(r.competitorId!) : OTHER);
  const mine = us ? share.rows.find((r) => r.competitorId === us.id) : undefined;
  const myRank = mine ? share.rows.indexOf(mine) + 1 : null;
  const partsOf = (rows: typeof share.rows) => rows.map((r) => ({ name: r.label, key: keyOf(r), value: r.coveredLives }));
  const colorByKey = new Map(history.flatMap((h) => h.share.rows.map((r) => [keyOf(r), colorOf(r)] as const)));
  const flag = checks.find((c) => c.state === state && c.segment === segment && Math.abs(c.diff) > 0.15);
  // Lines: every carrier that ever held 3%+ here; colored competitors in color, others gray.
  const lineKeys = [...new Set(history.flatMap((h) => h.share.rows.filter((r) => r.share >= 0.03).map(keyOf)))];
  const shareSeries = lineKeys.map((k) => {
    const label = history.flatMap((h) => h.share.rows).find((r) => keyOf(r) === k)!.label;
    const comp = history.flatMap((h) => h.share.rows).find((r) => keyOf(r) === k)?.competitorId ?? null;
    return { name: label, competitorId: has(comp ?? undefined) ? comp! : `__gray:${k}`, points: history.map((h) => ({ x: String(h.y), y: h.share.rows.find((r) => keyOf(r) === k)?.share ?? null })) };
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
        {SEGMENTS.map((s) => <Pill key={s} href={qs({ segment: s })} active={!selfMode && s === segment} label={SEGMENT_LABEL[s]} />)}
        <Pill href={qs({ segment: "SELF_FUNDED" })} active={selfMode} label="Self-funded (ASO)" />
        <span className="mx-1 text-stone-300">|</span>
        {financialYears.slice(0, 5).map((y) => <Pill key={y} href={qs({ year: y })} active={y === year} label={String(y)} />)}
      </div>

      <CoverageCheck highlight={state} open />

      {selfMode && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Self-funded (ASO) share · {state}</h2>
          {sf ? (
            <div className="card space-y-3 p-4">
              <p className="text-xs text-stone-500">Members in employer plans that pay their own claims, by the carrier administering them. {sourceLabel(sf)}. {Math.round(sf.total).toLocaleString("en-US")} members.{us && sf.rows.find((r) => r.competitorId === us.id) ? ` You: ${fmtPct(sf.rows.find((r) => r.competitorId === us.id)!.share)} (rank ${sf.rows.findIndex((r) => r.competitorId === us.id) + 1} of ${sf.rows.length}).` : ""}</p>
              <StackedShares rows={[{ label: "", total: sf.total, parts: sf.rows.map((r) => ({ name: r.label, key: r.competitorId ?? r.key, value: r.members })) }]} color={(k) => (has(k) ? color(k) : OTHER)} fmtTotal={(v) => Math.round(v).toLocaleString("en-US")} tall />
              <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {sf.rows.map((r) => (
                  <li key={r.key} className="flex items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: has(r.competitorId ?? undefined) ? color(r.competitorId!) : OTHER }} />
                    <span className={`min-w-0 flex-1 truncate ${r.competitorId ? "font-medium" : "text-stone-600"}`} title={r.notes?.[0]}>{r.label}{r.competitorId === us?.id ? " (you)" : ""}{r.basis?.some((b) => b !== "reported") ? <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] font-normal text-amber-800" title={r.notes?.[0] ?? BASIS[r.basis.find((b) => b !== "reported")!]}>est.</span> : null}</span>
                    {r.feePmpm ? <span className="text-[10px] tabular-nums text-stone-500" title="Administrative fee per member per month (fee income ÷ member months, as filed)">${r.feePmpm.toFixed(0)} fee</span> : null}
                    <span className="tabular-nums">{fmtPct(r.share)}</span>
                    <span className="w-16 text-right text-xs tabular-nums text-stone-500">{Math.round(r.members / 1000)}K</span>
                    <span className={`w-12 text-right text-xs tabular-nums ${deltaClass(r.prevMembers ? r.members / r.prevMembers - 1 : null)}`}>{r.prevMembers ? fmtSignedPct(r.members / r.prevMembers - 1, 0) : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Empty title={`No self-funded figures for ${state} yet`}>Self-funded lives come from CMS&apos;s loss-ratio filings for the six New England states; they load with the next loss-ratio import (System status).</Empty>
          )}
          {sf?.source === "cms_mlr" && (
            <p className="text-xs text-stone-600">
              These are lives on self-funded contracts <span className="font-medium">written in {state}</span>, as carriers file them with CMS (the same figures as the NAIC Supplemental Health Care Exhibit). A national employer based here counts all its members here, wherever they live, and some carriers&apos; counts include dental- or pharmacy-only administration. <span className="rounded bg-amber-50 px-1 text-amber-800">est.</span> marks carriers that don&apos;t file by state: Aetna files its whole national book under Connecticut, and UnitedHealthcare files none (a non-insurer subsidiary administers its plans; its national total comes from its annual results). Both are spread across states by where the carrier has fully insured group members. Hover a name for the detail.
            </p>
          )}
          {method && method.rows.length > 0 && (
            <details className="card" open={state !== "MA"}>
              <summary className="cursor-pointer px-4 py-2 text-sm font-medium">How good are these figures? Massachusetts check: federal filings and estimates vs CHIA&apos;s actual counts</summary>
              <div className="overflow-x-auto border-t border-stone-100">
                <table className="w-full text-sm" data-static>
                  <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Carrier · MA</th><th className="px-3 py-2">How</th><th className="px-3 py-2 text-right">Federal / estimate {method.year}</th><th className="px-3 py-2 text-right">CHIA residents {method.chiaAsOf.toISOString().slice(0, 7)}</th><th className="px-3 py-2 text-right">Ratio</th></tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {method.rows.map((r) => (
                      <tr key={r.label}><td className="px-3 py-1.5">{r.label}</td><td className="px-3 py-1.5 text-xs text-stone-600">{r.basis.map((b) => BASIS[b]).join("; ")}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(Math.round(r.federal))}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.chia != null ? fmtInt(Math.round(r.chia)) : "—"}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.chia ? `${(r.federal / r.chia).toFixed(1)}×` : "—"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-600">Estimates land close to CHIA where a carrier has no home-state effect (Aetna, UnitedHealthcare). Filed figures run about 3× CHIA for carriers based here or with national accounts written here (BCBSMA, Cigna), because they count members living in other states and non-medical administration. Carriers CHIA lists but the federal file doesn&apos;t (Anthem&apos;s national accounts, Tufts, MGB, Health New England) administer through entities that don&apos;t file. Expect the same pattern in other states: read filed figures as an upper bound on residents, and estimates as rough.</p>
            </details>
          )}
        </section>
      )}

      {!selfMode && <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Market share · {state} {SEGMENT_LABEL[segment].toLowerCase()} · {year}</h2>
          <p className="text-xs text-stone-500">Share of fully insured covered lives; the bar sums to 100%. {fmtInt(share.total)} lives.{segment !== "INDIVIDUAL" && !["MA", "NH"].includes(state) ? " Self-funded employers (most group coverage in this state) aren't included; see the coverage check above." : ""}</p>
        </div>
        {us && <p className="text-sm">{mine ? <><span className="font-medium">{us.name} (you):</span> {fmtPct(mine.share)} share, rank {myRank} of {share.rows.length}, {fmtInt(mine.coveredLives)} lives{mine.livesChange != null ? <>, <span className={deltaClass(mine.livesChange)}>{fmtSignedPct(mine.livesChange, 0)}</span> y/y</> : null}{myRank && myRank > 1 ? <> · {share.rows[0].label} leads by {((share.rows[0].share - mine.share) * 100).toFixed(1)} pts</> : null}</> : <span className="text-stone-500">{us.name} (you) has no fully insured {SEGMENT_LABEL[segment].toLowerCase()} business in {state}.</span>}</p>}
        {share.rows.length > 0 && (
          <div className="card space-y-3 p-4">
            <StackedShares rows={[{ label: "", total: share.total, parts: partsOf(share.rows) }]} color={(k) => colorByKey.get(k ?? "") ?? OTHER} fmtTotal={(v) => Math.round(v).toLocaleString("en-US")} tall />
            <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {share.rows.map((r) => (
                <li key={r.key} className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: colorOf(r) }} />
                  <span className={`min-w-0 flex-1 truncate ${r.competitorId ? "font-medium" : "text-stone-600"}`} title={r.label}>{r.label}{r.competitorId && r.competitorId === us?.id ? " (you)" : ""}</span>
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
      </section>}

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
