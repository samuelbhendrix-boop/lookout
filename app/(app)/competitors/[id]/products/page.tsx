import Link from "next/link";
import { DataAsOf } from "@/components/DataAsOf";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { competitorProducts, type Plan } from "@/lib/marketdata/products";
import { transparencyPlanCatalog } from "@/lib/marketdata/employers";
import { asoAccounts, asoBenchmarks } from "@/lib/marketdata/aso";
import { issuerPatternFor } from "@/lib/marketdata/queries";
import { fmtInt, fmtSignedPct, fmtUsd } from "@/components/charts";
import { NotIncluded } from "@/components/NotIncluded";
import { Empty } from "@/components/ui";
import { PlanNetworkTable } from "@/components/PlanNetworkTable";
import { LargeGroupCompetitor } from "@/components/LargeGroupProducts";
import { GicPlans } from "@/components/GicPlans";
import { gicLatest } from "@/lib/marketdata/gic";
import { groupProductLines, largeGroupMarket } from "@/lib/marketdata/lgbook";
import { NE_STATES } from "@/lib/marketdata/products";
import { directoryErrors } from "@/lib/marketdata/directory";
import { ProductStrategy } from "@/components/ProductDossier";
import { ProductNews } from "@/components/ProductNews";
import { RatingAreaMap } from "@/components/RatingAreaMap";

export const dynamic = "force-dynamic";

const usd = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const k = (n: number | null | undefined) => (n == null ? "—" : n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : `$${Math.round(n)}`);
const vs = (mine: number | null, market: number | null) => (mine == null || market == null || !market ? null : mine / market - 1);
const MARKET_LABEL: Record<string, string> = { Individual: "Individual", SHOP: "Small group" };
const short = (n: string) => n.replace(/,? (Inc|LLC|Co|Company|Corporation)\.?$/i, "").replace(/Blue Cross and Blue Shield/i, "BCBS").replace(/Health Plans?,? Inc/i, "Health");

function Delta({ v, invert = false }: { v: number | null; invert?: boolean }) {
  if (v == null) return <span className="text-stone-400">—</span>;
  const good = invert ? v > 0 : v < 0;
  return <span className={Math.abs(v) < 0.01 ? "text-stone-500" : good ? "text-emerald-700" : "text-red-600"}>{v > 0 ? "+" : ""}{(v * 100).toFixed(0)}%</span>;
}

function Section({ title, note, children }: { title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-semibold tracking-tight">{title}</h3>
        {note && <p className="text-xs text-stone-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export default async function CompetitorProductsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const session = (await getSession())!;
  const comp = await db.competitor.findFirst({ where: { id, workspaceId: session.workspaceId } });
  if (!comp) notFound();
  const state = sp.state && /^[A-Z]{2}$/.test(sp.state) ? sp.state : undefined;
  const [r, catalog, asoAll, asoBench, dirErr] = await Promise.all([competitorProducts(comp, { state }), transparencyPlanCatalog(comp), asoAccounts(), asoBenchmarks(state), directoryErrors()]);
  const [lgStates, lgLines] = await Promise.all([
    Promise.all((state ? [state] : NE_STATES).map((s) => largeGroupMarket(session.workspaceId, s))),
    groupProductLines(issuerPatternFor(comp)),
  ]);
  const lgPerState = lgStates.map((data) => ({ data, row: data.rows.find((x) => x.competitorId === comp.id) })).filter((x): x is { data: typeof x.data; row: NonNullable<typeof x.row> } => !!x.row);
  const compRe = (() => { try { return new RegExp(issuerPatternFor(comp), "i"); } catch { return null; } })();
  const isMine = (admin: string) => !!compRe?.test(admin) || admin === comp.name;
  const aso = asoAll.filter((a) => isMine(a.admin) && (!state || a.state === state)).sort((a, b) => (b.participants ?? 0) - (a.participants ?? 0));
  const myBench = asoBench.find((b) => isMine(b.admin));
  const lineupTotals = new Map(r.totals.map((t) => [`${t.state}|${t.market}`, t.enrollment]));
  const allStates = [...new Set([...r.states, ...r.lineup.map((l) => l.state)])].sort();
  const groupPlans = catalog.filter((p) => p.marketType === "group");

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/competitors/${comp.id}${state ? `?state=${state}` : ""}`} className="text-sm text-stone-500 hover:text-stone-900">← {comp.name}</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{comp.name} · commercial products</h1>
        <DataAsOf datasets={["qhp", "urrt", "dol_5500", "tic"]} />
        <p className="max-w-3xl text-sm text-stone-500">
          Every individual and small-group plan this carrier files, from CMS&apos;s Exchange plan files (benefit design, cost sharing, network, premiums by
          age) and its rate filings (enrollment, rate changes, off-exchange plans). Compared against every other carrier in the same state, market and metal tier.{" "}
          <Link className="underline" href={`/products${state ? `?state=${state}` : ""}`}>Compare all carriers →</Link>{" "}
          {(lgPerState.length > 0 || lgLines.lines.length > 0) && <a className="font-medium underline" href="#large-group">Large group ↓</a>}
        </p>
        <nav className="mt-4 flex flex-wrap gap-1 text-sm">
          <Link href={`/competitors/${comp.id}/products`} className={`rounded px-2.5 py-1 ${!state ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>All states</Link>
          {allStates.map((s) => <Link key={s} href={`/competitors/${comp.id}/products?state=${s}`} className={`rounded px-2.5 py-1 ${state === s ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>{s}</Link>)}
        </nav>
      </div>

      <ProductStrategy comp={comp} state={state} workspaceId={session.workspaceId} />
      <ProductNews workspaceId={session.workspaceId} competitorId={comp.id} days={365} limit={6} />

      {!r.markets.length && !r.lineup.length && (
        <Empty title="No individual or small-group filings matched">
          No Exchange plans or rate filings in New England match this competitor&apos;s filing-name pattern{state ? ` in ${state}` : ""}. Edit the pattern on the competitor page.
          {groupPlans.length > 0 && " Its group plan catalog is below."}
        </Empty>
      )}

      {/* ── At a glance ── */}
      {r.markets.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {r.markets.map((m) => {
            const share = m.marketEnrolled && m.enrolled != null ? m.enrolled / m.marketEnrolled : null;
            return (
              <a key={`${m.state}${m.market}`} href={`#${m.state}-${m.market}`} className="card block p-4 hover:bg-stone-50">
                <p className="font-mono text-[11px] uppercase tracking-wide text-stone-500">{m.state} · {MARKET_LABEL[m.market]} · {m.year}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{m.plans.length} <span className="text-sm font-normal text-stone-500">of {m.marketPlans} plans</span></p>
                <p className="text-xs text-stone-500">{m.types.join(" / ") || "—"} · {m.issuers} carriers on exchange</p>
                <dl className="mt-2 grid grid-cols-2 gap-y-0.5 text-sm">
                  <dt className="text-stone-500">Exchange enrollment</dt><dd className="text-right tabular-nums">{share != null ? `${(share * 100).toFixed(0)}%` : "—"}</dd>
                  {m.market === "Individual" && <><dt className="text-stone-500">Benchmark silver</dt><dd className="text-right tabular-nums">{m.bench.length ? `${m.benchHeld} of ${m.bench.length} areas` : "—"}</dd></>}
                  <dt className="text-stone-500">Cheapest in metal</dt><dd className="text-right tabular-nums">{m.position.filter((p) => p.rank === 1).map((p) => p.metal).join(", ") || "none"}</dd>
                  <dt className="text-stone-500">HSA-eligible</dt><dd className="text-right tabular-nums">{m.hsa}</dd>
                </dl>
              </a>
            );
          })}
        </div>
      )}

      {/* ── Per state × market ── */}
      {r.markets.map((m) => (
        <section key={`${m.state}${m.market}`} id={`${m.state}-${m.market}`} className="space-y-6 border-t border-stone-200 pt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{m.state} · {MARKET_LABEL[m.market]} · plan year {m.year}</h2>
            <Link href={`/products?state=${m.state}&market=${m.market}`} className="text-xs text-stone-500 hover:text-stone-900">All carriers in {m.state} →</Link>
          </div>
          <p className="text-sm text-stone-600">
            {m.plans.length} plans{m.networks.length ? ` on ${m.networks.length === 1 ? "the" : ""} ${m.networks.map((n) => `“${n}”`).join(", ")} network${m.networks.length === 1 ? "" : "s"}` : ""}
            {m.standardized ? ` · ${m.standardized} standardized design${m.standardized === 1 ? "" : "s"}` : ""}
            {m.tiered ? ` · ${m.tiered} tiered-network` : ""}
            {m.oon ? ` · ${m.oon} with out-of-network benefits` : " · no out-of-network benefits"}
            {m.enrolled ? ` · ${fmtInt(m.enrolled)} enrolled (${((m.enrolled / (m.marketEnrolled || 1)) * 100).toFixed(0)}% of on-exchange plans' filed enrollment)` : m.enrolled == null ? " · no filed enrollment for these plan ids yet" : ""}.
          </p>

          <Section title="Price and design position, by metal" note={`Monthly premium for a 40-year-old${m.communityRated ? " (Vermont is community-rated: one price at every age)" : ", median across rating areas"}. Rank = where this carrier's cheapest plan sits among ${m.issuers} carriers. Baby = member's total cost for the SBC "having a baby" example.`}>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
                  <tr><th className="px-3 py-2">Metal</th><th className="px-3 py-2 text-right">Plans</th><th className="px-3 py-2 text-right">Cheapest</th><th className="px-3 py-2 text-right">Rank</th><th className="px-3 py-2 text-right">vs market low</th><th className="px-3 py-2">Market low</th><th className="px-3 py-2 text-right">Deductible</th><th className="px-3 py-2 text-right">Mkt</th><th className="px-3 py-2 text-right">OOP max</th><th className="px-3 py-2 text-right">Mkt</th><th className="px-3 py-2 text-right">Baby</th><th className="px-3 py-2 text-right">Mkt</th></tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {m.position.map((p) => (
                    <tr key={p.metal} className={p.plans ? "" : "text-stone-400"}>
                      <td className="px-3 py-1.5 font-medium">{p.metal}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{p.plans}<span className="text-stone-400">/{p.marketPlans}</span></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{usd(p.lowest)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{p.rank ? <span className={p.rank === 1 ? "font-semibold text-emerald-700" : p.rank === p.issuers ? "text-red-600" : ""}>{p.rank} of {p.issuers}</span> : "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums"><Delta v={vs(p.lowest, p.marketLowest)} /></td>
                      <td className="px-3 py-1.5 text-xs text-stone-500">{p.rank === 1 ? "this carrier" : p.lowestBy ? `${usd(p.marketLowest)} ${short(p.lowestBy)}` : "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{k(p.ded)}</td><td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{k(p.marketDed)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{k(p.moop)}</td><td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{k(p.marketMoop)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{k(p.baby)}</td><td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{k(p.marketBaby)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {m.bench.length > 0 && (
            <Section title="Subsidy benchmark (second-lowest silver), by rating area" note="The benchmark silver plan sets every subsidized enrollee's tax credit; the cheapest silver and bronze plans are where price-shoppers land. Age 40.">
              <div className="card p-4">
                <RatingAreaMap state={m.state} scale="div" fmt={(v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`} valueLabel="Cheapest silver vs benchmark"
                  values={Object.fromEntries(m.bench.map((b) => { const xs = m.plans.filter((p) => p.metal === "Silver" && p.areaPrem40).map((p) => (p.areaPrem40 as Record<string, number>)[b.area]).filter((x): x is number => x != null); return [b.area, xs.length && b.benchmark ? Math.min(...xs) / b.benchmark.price - 1 : null]; }))}
                  mark={m.bench.filter((b) => b.benchmark && m.plans.some((p) => p.issuerId === b.benchmark!.issuerId)).map((b) => b.area)} markLabel="This carrier holds the benchmark"
                  caption="Green = its cheapest silver is under the benchmark (cheapest after subsidy); red = above." />
              </div>
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Rating area</th><th className="px-3 py-2">Lowest silver</th><th className="px-3 py-2">Benchmark (2nd lowest)</th><th className="px-3 py-2 text-right">This carrier&apos;s cheapest silver</th><th className="px-3 py-2 text-right">vs benchmark</th></tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {m.bench.map((b) => {
                      const mineIn = m.plans.filter((p) => p.metal === "Silver" && p.areaPrem40).map((p) => (p.areaPrem40 as Record<string, number>)[b.area]).filter((x): x is number => x != null);
                      const myLow = mineIn.length ? Math.min(...mineIn) : null;
                      const isMine = (who: { issuerId: string } | null) => !!who && m.plans.some((p) => p.issuerId === who.issuerId);
                      return (
                        <tr key={b.area}>
                          <td className="px-3 py-1.5">{b.area}</td>
                          <td className={`px-3 py-1.5 ${isMine(b.lowest) ? "font-semibold text-emerald-700" : ""}`}>{usd(b.lowest.price)} <span className="text-xs text-stone-500">{short(b.lowest.issuer)}</span></td>
                          <td className={`px-3 py-1.5 ${isMine(b.benchmark) ? "font-semibold text-emerald-700" : ""}`}>{b.benchmark ? <>{usd(b.benchmark.price)} <span className="text-xs text-stone-500">{short(b.benchmark.issuer)}</span></> : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{usd(myLow)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums"><Delta v={vs(myLow, b.benchmark?.price ?? null)} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          <Section title={`Plan designs (${m.plans.length})`} note={<>Premium for a 40-year-old (range across rating areas). Deductible and out-of-pocket max are in-network, individual. {m.hasCostShare ? "Copays shown as filed." : "Copays per service aren't in the state-exchange files; the SBC cost examples are the comparable measure."} Enrollment is from the plan&apos;s rate filing{m.plans.some((p) => p.enrollmentYear && p.enrollmentYear < m.year) ? " (prior year's filing where this year's isn't published yet)" : ""}.</>}>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
                  <tr><th className="px-3 py-2">Plan</th><th className="px-3 py-2">Metal</th><th className="px-3 py-2 text-right">Premium @40</th><th className="px-3 py-2 text-right">Deductible</th><th className="px-3 py-2 text-right">OOP max</th><th className="px-3 py-2 text-right">Coins.</th><th className="px-3 py-2 text-right">Baby / diabetes / fracture</th>{m.hasCostShare && <th className="px-3 py-2">PCP · Spec · ER · Generic</th>}<th className="px-3 py-2 text-right">Enrolled</th><th className="px-3 py-2 text-right">Rate chg</th></tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {m.plans.map((p: Plan) => {
                    const cs = (p.costShare ?? {}) as Record<string, string>;
                    return (
                      <tr key={p.planId} className="align-top">
                        <td className="min-w-[260px] max-w-[340px] px-3 py-1.5">
                          <span className="font-medium">{p.name}</span>
                          <div className="flex flex-wrap gap-1 pt-0.5 text-[10px]">
                            <span className="text-stone-500">{p.planType}{p.networkName ? ` · ${p.networkName}` : ""}{p.statewide ? " · statewide" : p.counties ? ` · ${p.counties} counties` : ""}</span>
                            {p.isNew && <span className="rounded bg-emerald-50 px-1 text-emerald-700">new</span>}
                            {p.hsa && <span className="rounded bg-sky-50 px-1 text-sky-700">HSA</span>}
                            {p.standardized && <span className="rounded bg-stone-100 px-1 text-stone-600">standardized</span>}
                            {p.tiered && <span className="rounded bg-amber-50 px-1 text-amber-800">tiered</span>}
                            {p.outOfNetwork && <span className="rounded bg-stone-100 px-1 text-stone-600">OON</span>}
                            {p.referral && <span className="rounded bg-stone-100 px-1 text-stone-600">referrals</span>}
                            {p.sbcUrl && <a className="text-stone-500 underline" href={p.sbcUrl} target="_blank" rel="noopener noreferrer">SBC</a>}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5">{p.metal}{p.av ? <div className="text-[10px] text-stone-500">AV {(p.av * 100).toFixed(1)}%</div> : null}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{usd(p.prem40)}{p.prem40Min != null && p.prem40Max != null && p.prem40Max - p.prem40Min > 1 ? <div className="text-[10px] text-stone-500">{usd(p.prem40Min)}–{usd(p.prem40Max)}</div> : null}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{usd(p.dedInd)}{p.drugDed ? <div className="text-[10px] text-stone-500">Rx {usd(p.drugDed)}</div> : null}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{usd(p.moopInd)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{p.coinsurance != null ? `${Math.round(p.coinsurance * 100)}%` : "—"}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-xs">{k(p.sbcBaby)} · {k(p.sbcDiabetes)} · {k(p.sbcFracture)}</td>
                        {m.hasCostShare && <td className="px-3 py-1.5 text-xs text-stone-600">{[cs.pcp, cs.specialist, cs.er, cs.generic].map((x) => x ?? "—").join(" · ")}</td>}
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(p.enrollment)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtSignedPct(p.rateChange)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {m.extras.length > 0 && (
            <Section title="Benefits beyond the essentials" note="Share of plans covering each benefit, this carrier vs every other carrier on the exchange. Green: covers where most competitors don't. Red: doesn't where most do.">
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Benefit</th><th className="px-3 py-2 text-right">This carrier</th><th className="px-3 py-2 text-right">Others</th><th className="px-3 py-2">By carrier</th></tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {m.extras.sort((a, b) => Math.abs(b.mine - b.others) - Math.abs(a.mine - a.others)).map((x) => (
                      <tr key={x.label}>
                        <td className={`px-3 py-1.5 ${x.mine - x.others >= 0.5 ? "font-medium text-emerald-700" : x.others - x.mine >= 0.5 ? "font-medium text-red-600" : ""}`}>{x.label}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(x.mine * 100)}%</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{Math.round(x.others * 100)}%</td>
                        <td className="px-3 py-1.5 text-xs text-stone-500">{x.byIssuer.filter((b) => b.share > 0).map((b) => `${short(b.name)}${b.share < 1 ? ` ${Math.round(b.share * 100)}%` : ""}`).join(" · ") || "nobody"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          <PlanNetworkTable plans={m.plans.map((p: Plan) => ({ planId: p.planId, name: p.name, metal: p.metal }))} />

          {m.changes && (
            <Section title={`What changed from ${m.changes.prevYear}`} note={`${m.changes.plansBefore} plans in ${m.changes.prevYear} → ${m.plans.length} in ${m.year}; ${m.changes.continuing} continued (matched on plan id or name). Premium change = median across continuing plans, age 40.`}>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="card space-y-2 p-4 text-sm">
                  <p><span className="font-medium">Premiums on continuing plans:</span> {fmtSignedPct(m.changes.premiumChange)} <span className="text-stone-500">(market {fmtSignedPct(m.changes.marketPremiumChange)})</span></p>
                  <table className="w-full text-xs">
                    <thead className="text-left text-stone-500"><tr><th>Cheapest</th><th className="text-right">{m.changes.prevYear}</th><th className="text-right">{m.year}</th><th className="text-right">Change</th><th className="text-right">Market low chg</th></tr></thead>
                    <tbody>{m.changes.lowest.map((x) => <tr key={x.metal}><td>{x.metal}</td><td className="text-right tabular-nums">{usd(x.before)}</td><td className="text-right tabular-nums">{usd(x.now)}</td><td className="text-right tabular-nums">{fmtSignedPct(vs(x.now, x.before))}</td><td className="text-right tabular-nums text-stone-500">{fmtSignedPct(vs(x.marketNow, x.marketBefore))}</td></tr>)}</tbody>
                  </table>
                  {(m.changes.hsaBefore !== m.changes.hsaNow) && <p>HSA-eligible plans: {m.changes.hsaBefore} → {m.changes.hsaNow}</p>}
                  {m.changes.networksAdded.length > 0 && <p>New network{m.changes.networksAdded.length > 1 ? "s" : ""}: {m.changes.networksAdded.join(", ")}</p>}
                  {m.changes.networksDropped.length > 0 && <p>Network{m.changes.networksDropped.length > 1 ? "s" : ""} retired: {m.changes.networksDropped.join(", ")}</p>}
                  {m.changes.benefitChanges.map((b) => <p key={b.label}>{b.label}: {Math.round(b.before * 100)}% of plans → {Math.round(b.now * 100)}%</p>)}
                </div>
                <div className="card space-y-2 p-4 text-sm">
                  {m.changes.added.length > 0 && <div><p className="font-medium text-emerald-700">New ({m.changes.added.length})</p><ul className="text-xs text-stone-600">{m.changes.added.map((p) => <li key={p.name}>{p.name} · {p.metal} · {usd(p.prem40)} · ded {usd(p.dedInd)}</li>)}</ul></div>}
                  {m.changes.dropped.length > 0 && <div><p className="font-medium text-red-600">Discontinued ({m.changes.dropped.length})</p><ul className="text-xs text-stone-600">{m.changes.dropped.map((p) => <li key={p.name}>{p.name} · {p.metal} · was {usd(p.prem40)} · ded {usd(p.dedInd)}</li>)}</ul></div>}
                  {m.changes.dedChanges.length > 0 && <div><p className="font-medium">Deductible changes ({m.changes.dedChanges.length})</p><ul className="text-xs text-stone-600">{m.changes.dedChanges.slice(0, 12).map((d) => <li key={d.name}>{d.name}: {usd(d.from)} → {usd(d.to)}</li>)}</ul></div>}
                  {m.changes.moopChanges.length > 0 && <p className="text-xs text-stone-600">Out-of-pocket max changed on {m.changes.moopChanges.length} plan{m.changes.moopChanges.length === 1 ? "" : "s"} (federal maximum moves every year).</p>}
                  {!m.changes.added.length && !m.changes.dropped.length && !m.changes.dedChanges.length && <p className="text-stone-500">Same plans and deductibles as {m.changes.prevYear}.</p>}
                </div>
              </div>
            </Section>
          )}
        </section>
      ))}

      {/* ── Full line-up from rate filings ── */}
      {r.lineup.length > 0 && (
        <section className="space-y-2 border-t border-stone-200 pt-6">
          <h2 className="text-lg font-semibold tracking-tight">Full product line-up · rate filings {r.lineupYear}</h2>
          <p className="text-xs text-stone-500">Every individual and small-group product filed with CMS, including off-exchange plans (which is most of the small-group market outside the exchange). Share = this product&apos;s filed enrollment ÷ all carriers&apos; in that state and market. Rate change is enrollment-weighted over renewing plans.</p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Product</th><th className="px-3 py-2">Market</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Metals</th><th className="px-3 py-2 text-right">Plans</th><th className="px-3 py-2 text-right">On exch.</th><th className="px-3 py-2 text-right">Enrolled</th><th className="px-3 py-2 text-right">Share</th><th className="px-3 py-2 text-right">Rate chg</th><th className="px-3 py-2 text-right">Avg PMPM</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {r.lineup.map((l) => {
                  const tot = lineupTotals.get(`${l.state}|${l.market}`) ?? 0;
                  return (
                    <tr key={`${l.state}${l.market}${l.productId}`}>
                      <td className="px-3 py-1.5"><span className="font-medium">{l.productName}</span> <span className="font-mono text-[10px] text-stone-400">{l.productId}</span></td>
                      <td className="whitespace-nowrap px-3 py-1.5">{l.state} {l.state === "MA" ? "Merged" : l.market}</td>
                      <td className="px-3 py-1.5">{l.planType ?? "—"}</td>
                      <td className="px-3 py-1.5 text-xs text-stone-600">{(l.metals ?? []).sort((a, b) => ["Platinum", "Gold", "Silver", "Expanded Bronze", "Bronze", "Catastrophic"].indexOf(a) - ["Platinum", "Gold", "Silver", "Expanded Bronze", "Bronze", "Catastrophic"].indexOf(b)).join(", ")}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{l.plans}{l.newPlans ? <span className="text-emerald-700"> +{l.newPlans}</span> : null}{l.terminated ? <span className="text-red-600"> −{l.terminated}</span> : null}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.onExchange}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(l.enrollment)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{tot ? `${((l.enrollment / tot) * 100).toFixed(1)}%` : "—"}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${l.rateChange != null && l.rateChange > 0.1 ? "text-red-600" : ""}`}>{fmtSignedPct(l.rateChange)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtUsd(l.pmpm)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Self-funded administration (Schedule C) ── */}
      {asoBench.length > 0 && (
        <section className="space-y-3 border-t border-stone-200 pt-6">
          <h2 className="text-lg font-semibold tracking-tight">Self-funded administration · Form 5500 Schedule C</h2>
          <p className="max-w-3xl text-xs text-stone-500">Employers whose self-funded plan paid this carrier (or its TPA) to administer medical claims, and what they paid — the only public view of ASO pricing. Fee per participant per month = reported compensation ÷ participants ÷ 12; it can include network access, care management and other services the administrator bills to the plan. Schedule C is filed only when a plan pays providers $5,000+ from plan assets, so this is a sample of each book, not all of it.</p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Administrator{state ? ` · ${state}` : " · New England"}</th><th className="px-3 py-2 text-right">Employers</th><th className="px-3 py-2 text-right">Participants</th><th className="px-3 py-2 text-right">25th pct</th><th className="px-3 py-2 text-right">Median fee PEPM</th><th className="px-3 py-2 text-right">75th pct</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {asoBench.filter((b) => b.accounts >= 2).map((b) => (
                  <tr key={b.admin} className={isMine(b.admin) ? "bg-stone-50 font-medium" : ""}>
                    <td className="px-3 py-1.5">{b.admin}</td><td className="px-3 py-1.5 text-right tabular-nums">{b.accounts}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(b.participants)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtUsd(b.p25)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtUsd(b.median)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtUsd(b.p75)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {aso.length > 0 ? (
            <details className="card" open={aso.length <= 15}>
              <summary className="cursor-pointer px-4 py-2 text-sm">{aso.length} self-funded employers administered by {comp.name}{myBench?.median ? ` · median $${myBench.median.toFixed(0)} per participant per month` : ""}</summary>
              <table className="w-full border-t border-stone-100 text-sm">
                <thead className="text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Employer</th><th className="px-3 py-2 text-right">Participants</th><th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">PEPM</th><th className="px-3 py-2">Filed as</th><th className="px-3 py-2">Broker</th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {aso.map((a) => (
                    <tr key={a.planId}>
                      <td className="px-3 py-1.5"><Link className="hover:underline" href={`/employers?q=${encodeURIComponent(a.sponsor)}`}>{a.sponsor}</Link><span className="text-xs text-stone-500"> · {a.city ? `${a.city}, ` : ""}{a.state} · {a.year}</span></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(a.participants)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtUsd(a.fee)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${a.pepm && myBench?.median && a.pepm > myBench.median * 1.25 ? "text-red-600" : ""}`}>{a.pepm ? `$${a.pepm.toFixed(0)}` : "—"}</td>
                      <td className="px-3 py-1.5 text-xs text-stone-500">{a.name}</td>
                      <td className="px-3 py-1.5 text-xs text-stone-500">{a.brokers.slice(0, 2).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : <p className="text-sm text-stone-500">No self-funded employers name {comp.name} as claims administrator on Schedule C{state ? ` in ${state}` : ""}.</p>}
        </section>
      )}

      {/* ── Group / ASO catalog ── */}
      {(lgPerState.length > 0 || lgLines.lines.length > 0) && <LargeGroupCompetitor perState={lgPerState} lines={lgLines.lines} totalPlans={lgLines.total} />}
      {(!state || state === "MA") && compRe && gicLatest().plans.some((p) => compRe.test(p.carrier)) && <GicPlans match={(c) => compRe.test(c)} only />}

      {groupPlans.length > 0 && (
        <section className="space-y-2 border-t border-stone-200 pt-6">
          <h2 className="text-lg font-semibold tracking-tight">All group plan names · {groupPlans.length}</h2>
          <p className="text-xs text-stone-500">Large-group and self-funded plan designs aren&apos;t publicly filed. This is the list of plan names the carrier publishes in its Transparency in Coverage index, with the employer that sponsors each where given.</p>
          <details className="card">
            <summary className="cursor-pointer px-4 py-2 text-sm">Show all {groupPlans.length}</summary>
            <ul className="grid gap-x-6 gap-y-0.5 border-t border-stone-100 px-4 py-3 text-xs text-stone-700 sm:grid-cols-2">
              {groupPlans.slice(0, 1500).map((p) => <li key={`${p.planName}${p.sponsorName}`} className="truncate" title={`${p.planName}${p.sponsorName ? ` — ${p.sponsorName}` : ""}`}>{p.planName}{p.sponsorName ? <span className="text-stone-400"> · {p.sponsorName}</span> : null}</li>)}
            </ul>
          </details>
        </section>
      )}

      <NotIncluded items={[
        <>Exchange plan files cover plans certified for each state&apos;s exchange: the full individual market in most states, but only exchange-listed small-group plans. Off-exchange products are in the line-up (rate filings) without benefit detail.</>,
        <>Plan years available: {Object.entries(r.latest).map(([s, y]) => `${s} through ${y}`).join(", ")}. New Hampshire uses the federal platform, whose files arrive before open enrollment; state-exchange files arrive the following spring.</>,
        <>Per-service copays are published only for federal-platform states (NH). Elsewhere, compare with the SBC cost examples (baby, diabetes, fracture), which every plan must calculate the same way.</>,
        <>Premiums are list rates before subsidies, non-tobacco. Massachusetts ConnectorCare and other state subsidy programs are not shown.</>,
        <>Large-group and self-funded benefit designs are not filed publicly; only plan names are available.</>,
        <>Provider networks and formularies come from insurers&apos; machine-readable files, which CMS requires only on the federal platform: in New England that is New Hampshire&apos;s exchange plans (Anthem, Harvard Pilgrim and Ambetter; Ambetter publishes facilities only). State-exchange plans in MA, CT, RI, VT and ME have no such files.{dirErr?.errors.length ? ` Last run couldn't read: ${dirErr.errors.join("; ")}.` : ""}</>,
      ]} />
    </div>
  );
}
