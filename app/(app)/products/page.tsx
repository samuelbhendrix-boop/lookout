import Link from "next/link";
import { DataAsOf } from "@/components/DataAsOf";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { DIFFERENTIATORS, marketProducts, metalOrder, NE_STATES, qhpYears } from "@/lib/marketdata/products";
import { issuerPatternFor } from "@/lib/marketdata/queries";
import { fmtInt } from "@/components/charts";
import { NotIncluded } from "@/components/NotIncluded";
import { PlanNetworkTable } from "@/components/PlanNetworkTable";
import { LargeGroupMarket } from "@/components/LargeGroupProducts";
import { GicPlans } from "@/components/GicPlans";
import { ProductNews } from "@/components/ProductNews";
import { ProductMatrix } from "@/components/ProductDossier";
import { MarketingMatrix } from "@/components/ProductMarketing";
import { RatingAreaMap } from "@/components/RatingAreaMap";
import { largeGroupMarket } from "@/lib/marketdata/lgbook";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

const usd = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const k = (n: number | null | undefined) => (n == null ? "—" : n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : `$${Math.round(n)}`);
const short = (n: string) => n.replace(/,? (Inc|LLC|Co|Company|Corporation)\.?$/i, "").replace(/Blue Cross and Blue Shield/i, "BCBS").replace(/Health Plans?,? Inc/i, "Health");

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const state = NE_STATES.includes(sp.state ?? "") ? sp.state! : "MA";
  const market = sp.market === "SHOP" ? "SHOP" : sp.market === "LG" ? "LG" : sp.market === "MKT" ? "MKT" : "Individual";
  const { rows } = await qhpYears();
  const years = rows.filter((r) => r.state === state).map((r) => r.year).sort();
  const year = years.includes(Number(sp.year)) ? Number(sp.year) : years.at(-1);
  const [mk, competitors, lg] = await Promise.all([
    year && (market === "Individual" || market === "SHOP") ? marketProducts(state, market, year) : null,
    db.competitor.findMany({ where: { workspaceId: session.workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } }),
    market === "LG" ? largeGroupMarket(session.workspaceId, state) : null,
  ]);
  const compFor = (issuer: string) => competitors.find((c) => { try { return new RegExp(issuerPatternFor(c), "i").test(issuer); } catch { return false; } });
  const qs = (o: Record<string, string | undefined>) => `/products?${new URLSearchParams(Object.entries({ state, market, year: year ? String(year) : undefined, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const chip = (on: boolean) => `rounded px-2.5 py-1 ${on ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`;
  const metal = mk && mk.metals.includes(sp.metal ?? "") ? sp.metal! : mk?.metals.includes("Silver") ? "Silver" : mk?.metals[0];
  const inMetal = mk ? mk.plans.filter((p) => (p.metal === "Expanded Bronze" ? "Bronze" : p.metal) === metal).sort((a, b) => (a.prem40 ?? 1e9) - (b.prem40 ?? 1e9)) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Commercial products</h1>
        <DataAsOf datasets={market === "LG" ? ["mlr", "ma_chia", "dol_5500", "tic"] : ["qhp", "urrt"]} />
        {market === "MKT" ? <p className="max-w-3xl text-sm text-stone-500">How each carrier structures and sells its commercial products (virtual-first, limited or tiered networks, health-system plans, funding options) from its own marketing pages and brochures.</p> : market === "LG" ? <p className="max-w-3xl text-sm text-stone-500">Each carrier&apos;s large-group book: fully and self-insured members, premium and claims per member, what employers actually pay per covered person by group size, renewal increases, broker pay, product mix, and regulator rate reviews where published. Open a carrier for its large-group product line-up.</p> : <p className="max-w-3xl text-sm text-stone-500">Every carrier&apos;s exchange plans side by side: price at each metal tier, deductibles, networks, HSA options and the benefits that set them apart. From CMS&apos;s Exchange plan files, joined to rate filings for enrollment. Open a carrier for its full line-up and what changed this year.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {NE_STATES.map((s) => <Link key={s} href={qs({ state: s, year: undefined })} className={chip(state === s)}>{s}</Link>)}
        <span className="mx-2 text-stone-300">|</span>
        {["Individual", "SHOP", "LG", "MKT"].map((m) => <Link key={m} href={qs({ market: m })} className={chip(market === m)}>{m === "SHOP" ? "Small group" : m === "LG" ? "Large group" : m === "MKT" ? "How they're sold" : m}</Link>)}
        {market !== "LG" && market !== "MKT" && <><span className="mx-2 text-stone-300">|</span>
        {years.map((y) => <Link key={y} href={qs({ year: String(y) })} className={chip(year === y)}>{y}</Link>)}</>}
      </div>

      {market === "MKT" ? <MarketingMatrix workspaceId={session.workspaceId} /> : <>
      <ProductNews workspaceId={session.workspaceId} limit={8} />

      {market !== "LG" && <ProductMatrix workspaceId={session.workspaceId} state={state} />}

      {lg ? (
        lg.rows.length ? <>
          {state === "MA" && <GicPlans match={(carrier) => !!compFor(carrier)} />}
          <LargeGroupMarket data={lg} />
          <NotIncluded items={[
            <>Carriers don&apos;t file large-group rates or benefit designs with CMS, and only Rhode Island publishes a large-group rate review, so there is no plan-by-plan comparison like the exchange view. Open a carrier for its product line-up from its transparency index.</>,
            <>Form 5500 covers employers with 100+ participants that buy insurance through an ERISA plan; governments, churches and most 51–99 groups don&apos;t file. Premium per covered person mixes single and family coverage, so compare carriers on the same size band.</>,
            <>Self-insured membership is published only where the state collects it (MA CHIA, NH); other states show fully insured only.</>,
          ]} />
        </> : <Empty title={`No large-group data for ${state} yet`}>Loss-ratio filings and Form 5500 import in the background; check System status.</Empty>
      ) : !mk || !mk.grid.length ? <Empty title="No exchange plans on file for this state and market">The plan files import in the background after deploy; check System status.</Empty> : (
        <>
          <section className="space-y-2">
            <h2 className="font-semibold tracking-tight">Cheapest plan by metal · age 40, monthly{mk.communityRated ? " (community-rated)" : ""}</h2>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
                  <tr><th className="px-3 py-2">Carrier</th>{mk.metals.map((m) => <th key={m} className="px-3 py-2 text-right">{m}</th>)}<th className="px-3 py-2 text-right">Plans</th><th className="px-3 py-2 text-right">Enrolled</th><th className="px-3 py-2">Network · type</th><th className="px-3 py-2 text-right">HSA</th></tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {mk.grid.map((g) => {
                    const c = compFor(g.name);
                    return (
                      <tr key={g.id} className="align-top">
                        <td className="max-w-[220px] px-3 py-2">{c ? <Link className="font-medium hover:underline" href={`/competitors/${c.id}/products?state=${state}#${state}-${market}`}>{short(g.name)}</Link> : <span className="font-medium">{short(g.name)}</span>}</td>
                        {mk.metals.map((m) => {
                          const x = g.byMetal[m];
                          const best = x.low != null && x.low === mk.lowByMetal[m];
                          return <td key={m} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{x.n ? <><span className={best ? "font-semibold text-emerald-700" : ""}>{usd(x.low)}</span><div className="text-[10px] text-stone-500">{x.n} plan{x.n > 1 ? "s" : ""} · ded {k(x.ded)}</div></> : <span className="text-stone-300">—</span>}</td>;
                        })}
                        <td className="px-3 py-2 text-right tabular-nums">{g.plans}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtInt(g.enrolled || null)}</td>
                        <td className="max-w-[200px] px-3 py-2 text-xs text-stone-600"><span className="line-clamp-2" title={g.networks.join("; ")}>{g.networks.join("; ") || "—"}</span>{g.types.join("/")}{g.statewide ? " · statewide" : g.counties ? ` · ${g.counties} counties` : ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{g.hsa}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {mk.bench.length > 0 ? (
            <section className="space-y-2">
              <h2 className="font-semibold tracking-tight">Who sets the subsidy benchmark</h2>
              <p className="text-xs text-stone-500">Second-lowest-cost silver plan in each rating area, age 40. It fixes every subsidized enrollee&apos;s tax credit, so whoever prices under it is cheapest after subsidy.</p>
              <div className="card p-4"><RatingAreaMap state={state} values={Object.fromEntries(mk.bench.map((b) => [b.area, b.benchmark?.price ?? null]))} fmt={(v) => usd(v)} valueLabel="Benchmark silver" caption="Darker = higher benchmark premium (age 40, monthly)." /></div>
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Rating area</th><th className="px-3 py-2">Lowest silver</th><th className="px-3 py-2">Benchmark silver</th><th className="px-3 py-2 text-right">Silver plans</th></tr></thead>
                  <tbody className="divide-y divide-stone-100">{mk.bench.map((b) => <tr key={b.area} id={`area-${b.area.replace(/\D/g, "")}`}><td className="px-3 py-1.5">{b.area}</td><td className="px-3 py-1.5">{usd(b.lowest.price)} <span className="text-xs text-stone-500">{short(b.lowest.issuer)} · {b.lowest.name}</span></td><td className="px-3 py-1.5">{b.benchmark ? <>{usd(b.benchmark.price)} <span className="text-xs text-stone-500">{short(b.benchmark.issuer)} · {b.benchmark.name}</span></> : "—"}</td><td className="px-3 py-1.5 text-right tabular-nums">{b.silverPlans}</td></tr>)}</tbody>
                </table>
              </div>
            </section>
          ) : (
            <section className="space-y-2">
              <h2 className="font-semibold tracking-tight">Rating areas</h2>
              <p className="text-xs text-stone-500">Carriers can price differently in each rating area; plan premiums on this page are the median across them.</p>
              <div className="card p-4"><RatingAreaMap state={state} compact /></div>
            </section>
          )}

          <section className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold tracking-tight">Every {metal} plan, cheapest first</h2>
              <div className="flex gap-1 text-xs">{mk.metals.map((m) => <Link key={m} href={qs({ metal: m })} className={chip(metal === m)}>{m}</Link>)}</div>
            </div>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Plan</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2 text-right">@40</th><th className="px-3 py-2 text-right">Deductible</th><th className="px-3 py-2 text-right">OOP max</th><th className="px-3 py-2 text-right">Baby</th><th className="px-3 py-2 text-right">Enrolled</th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {inMetal.map((p) => (
                    <tr key={p.planId}>
                      <td className="max-w-[320px] px-3 py-1.5"><span className="font-medium">{p.name}</span><div className="text-[10px] text-stone-500">{p.planType}{p.networkName ? ` · ${p.networkName}` : ""}{p.hsa ? " · HSA" : ""}{p.isNew ? " · new" : ""}{p.standardized ? " · standardized" : ""}</div></td>
                      <td className="px-3 py-1.5 text-xs">{short(p.issuerName ?? p.issuerId)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{usd(p.prem40)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{usd(p.dedInd)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{usd(p.moopInd)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{usd(p.sbcBaby)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(p.enrollment)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold tracking-tight">Benefits beyond the essentials · share of each carrier&apos;s plans</h2>
            <div className="card overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Benefit</th>{mk.grid.map((g) => <th key={g.id} className="px-2 py-2 text-right">{short(g.name).slice(0, 18)}</th>)}</tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {DIFFERENTIATORS.map((d) => ({ d, xs: mk.grid.map((g) => g.extras.find((e) => e.label === d.label)!.share) })).filter((x) => x.xs.some((v) => v > 0)).map(({ d, xs }) => (
                    <tr key={d.label}><td className="px-3 py-1.5">{d.label}</td>{xs.map((v, i) => <td key={i} className={`px-2 py-1.5 text-right tabular-nums ${v >= 0.99 ? "font-medium text-emerald-700" : v === 0 ? "text-stone-300" : ""}`}>{v === 0 ? "—" : `${Math.round(v * 100)}%`}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <PlanNetworkTable title={`Network and formulary · ${metal} plans`} plans={inMetal.map((p) => ({ planId: p.planId, name: p.name, issuer: short(p.issuerName ?? p.issuerId) }))} />

          <NotIncluded items={[
            <>Provider networks and formularies are only published in machine-readable form for federal-platform (New Hampshire) exchange plans; other states show none.</>,
            <>Exchange-certified plans only. Off-exchange products (most of the small-group market in some states) are in each carrier&apos;s line-up from rate filings, without benefit detail.</>,
            <>List premiums before subsidies, non-tobacco, median across rating areas. {metalOrder("Silver") >= 0 ? "Expanded bronze is grouped with bronze." : ""}</>,
            <>Enrollment comes from the plan&apos;s rate filing (enrollment at filing time); new plans and federal-platform years ahead of filings show none.</>,
          ]} />
        </>
      )}
      </>}
    </div>
  );
}
