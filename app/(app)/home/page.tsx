import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { AUTO_FILTER_TAG } from "@/lib/relevance";
import { MARKET_NOISE } from "@/lib/briefing";
import { accountMoves, competitorsOf, rankCompetitors, exchangeTrend, filedRateChanges, networkPosition, premiumTrend } from "@/lib/homecharts";
import { accountsInPlay } from "@/lib/marketdata/inplay";
import { NE_STATES } from "@/lib/marketdata/products";
import { colorMap, HBars, hasColor, Legend, LineChart } from "@/components/viz";
import { timeAgo } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

const SEGMENTS = { LARGE_GROUP: "Large group", SMALL_GROUP: "Small group", INDIVIDUAL: "Individual" } as const;
type Seg = keyof typeof SEGMENTS;
const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const pct = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const lives = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v)));

function greeting() {
  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Card({ title, sub, href, cta, children, className = "" }: { title: string; sub?: React.ReactNode; href?: string; cta?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card min-w-0 p-4 ${className}`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="text-sm font-semibold tracking-tight">{title}</h3>{sub && <p className="text-[11px] text-stone-500">{sub}</p>}</div>
        {href && <Link href={href} className="shrink-0 text-xs text-stone-500 hover:text-stone-900">{cta ?? "More"} →</Link>}
      </div>
      {children}
    </section>
  );
}

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const state = NE_STATES.includes(sp.state ?? "") ? sp.state! : "MA";
  const seg: Seg = sp.seg && sp.seg in SEGMENTS ? (sp.seg as Seg) : "LARGE_GROUP";
  const { comps, match } = await competitorsOf(session.workspaceId);
  const ranked = await rankCompetitors(session.workspaceId);
  const color = colorMap(ranked);
  void comps;
  const [prem, filed, exch, sales, net, play, productNews, changes30] = await Promise.all([
    premiumTrend(match, state, seg),
    filedRateChanges(match, state),
    exchangeTrend(match, state),
    accountMoves(match),
    networkPosition(match),
    accountsInPlay(session.workspaceId, { days: 90, state }),
    db.signal.findMany({
      where: { workspaceId: session.workspaceId, duplicateOfId: null, status: { not: "ARCHIVED" }, competitorId: { not: null }, type: { in: ["PRODUCT", "PRICING", "NETWORK"] },
        tags: { none: { tag: { name: { in: ["market-data", AUTO_FILTER_TAG] } } } }, OR: [{ publishedAt: { gte: new Date(Date.now() - 60 * 864e5) } }, { publishedAt: null, createdAt: { gte: new Date(Date.now() - 60 * 864e5) } }] },
      orderBy: [{ importance: "desc" }, { publishedAt: { sort: "desc", nulls: "last" } }], take: 60, include: { competitor: { select: { name: true } } },
    }).then((xs) => xs.filter((s) => !MARKET_NOISE.test(s.title)).slice(0, 6)),
    db.marketEvent.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * 864e5) }, importance: { gte: 3 } } }),
  ]);
  const qs = (o: Record<string, string>) => `/home?${new URLSearchParams({ state, seg, ...o })}`;
  const chip = (on: boolean) => `rounded px-2.5 py-1 ${on ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`;
  const first = (session.name ?? "").split(" ")[0];
  const top6 = <T extends { name: string; competitorId?: string; points: Array<{ y: number | null }> }>(s: T[]) => {
    const mkt = s.filter((x) => !x.competitorId);
    const comps = s.filter((x) => hasColor(ranked, x.competitorId)).sort((a, b) => b.points.filter((p) => p.y != null).length - a.points.filter((p) => p.y != null).length || (b.points.at(-1)?.y ?? 0) - (a.points.at(-1)?.y ?? 0));
    return [...comps.slice(0, 6), ...mkt];
  };
  const legendFor = (s: Array<{ name: string; competitorId?: string }>) => s.map((x) => ({ name: x.name, color: color(x.competitorId), dashed: !x.competitorId }));

  // Headline numbers.
  const mkt = filed.rows.find((r) => r.name === "Market");
  const lastYearIdx = filed.years.length - 1;
  const mktFiled = mkt?.values[lastYearIdx] ?? null;
  const premMkt = prem.series.find((s) => s.name === "Market");
  const premLast = premMkt?.points.at(-1)?.y ?? null, premPrev = premMkt?.points.at(-2)?.y ?? null;
  const cheapestHosp = net.position.filter((p) => p.competitorId)[0];
  const topWinner = sales.rows[0];
  const hot = play.rows.filter((r) => r.score >= 3);

  const filedComp = filed.rows.filter((r) => r.name !== "Market").sort((a, b) => (b.values[lastYearIdx] ?? -9) - (a.values[lastYearIdx] ?? -9));
  const yearColors = ["#a8a29e", "#2a78d6", "#1c1917"].slice(-filed.years.length);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting()}{first ? `, ${first}` : ""}.</h1>
          <p className="text-sm text-stone-500">Pricing, networks, products and sales for your competitors · {state}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {NE_STATES.map((s) => <Link key={s} href={qs({ state: s })} className={chip(state === s)}>{s}</Link>)}
          <Link href="/updates" className="btn-ghost ml-2 py-1 text-xs">All updates ({changes30} changes in 30d) →</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4"><p className="font-mono text-[10px] uppercase tracking-wide text-stone-500">Filed rate change {filed.years.at(-1) ?? ""}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{mktFiled != null ? pct(mktFiled) : "—"}</p><p className="text-xs text-stone-500">{state} individual + small group, renewing plans</p></div>
        <div className="card p-4"><p className="font-mono text-[10px] uppercase tracking-wide text-stone-500">{SEGMENTS[seg]} premium PMPM</p><p className="mt-1 text-2xl font-semibold tabular-nums">{premLast != null ? usd(premLast) : "—"}</p><p className="text-xs text-stone-500">{premLast && premPrev ? `${pct(premLast / premPrev - 1)} vs ${prem.years.at(-2)}` : "market, fully insured"}</p></div>
        <Link href="/leverage" className="card block p-4 hover:bg-stone-50"><p className="font-mono text-[10px] uppercase tracking-wide text-stone-500">Lowest hospital prices</p><p className="mt-1 truncate text-2xl font-semibold">{cheapestHosp ? cheapestHosp.name : "—"}</p><p className="text-xs text-stone-500">{cheapestHosp ? `${cheapestHosp.median.toFixed(2)}× Medicare across ${cheapestHosp.hospitals} hospitals` : "no hospital rates yet"}</p></Link>
        <Link href="/accounts" className="card block p-4 hover:bg-stone-50"><p className="font-mono text-[10px] uppercase tracking-wide text-stone-500">Biggest net account gain</p><p className="mt-1 truncate text-2xl font-semibold">{topWinner && topWinner.wonLives > topWinner.lostLives ? topWinner.name : "—"}</p><p className="text-xs text-stone-500">{topWinner ? `+${lives(topWinner.wonLives - topWinner.lostLives)} lives net, ${sales.years}` : "no account moves"} · {hot.length} in play</p></Link>
      </div>

      <h2 className="font-mono text-xs uppercase tracking-wide text-stone-500">Pricing</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Premium per member per month · ${SEGMENTS[seg]}`} sub={`Fully insured, ${state}, CMS loss-ratio filings. Dashed = whole market.`} href="/market" cta="Market">
          <div className="mb-2 flex gap-1 text-[11px]">{(Object.keys(SEGMENTS) as Seg[]).map((k) => <Link key={k} href={qs({ seg: k })} className={chip(seg === k)}>{SEGMENTS[k]}</Link>)}</div>
          <LineChart series={top6(prem.series)} x={prem.years} color={color} fmt={usd} />
          <Legend items={legendFor(top6(prem.series))} />
        </Card>
        <Card title="Filed rate increases" sub={`Average requested change on renewing ACA plans, ${state}, by plan year (enrollment-weighted).`} href="/rates" cta="Rates">
          <HBars rows={[...(mkt ? [{ name: "Market", values: mkt.values }] : []), ...filedComp]} keys={filed.years} colors={yearColors} fmt={pct} reference={{ value: 0, label: "0%" }} />
          <Legend items={filed.years.map((y, i) => ({ name: y, color: yearColors[i] }))} />
        </Card>
        <Card title="Cheapest silver plan, age 40" sub={`Monthly premium on the ${state} exchange, by plan year.`} href={`/products?state=${state}`} cta="Products">
          <LineChart series={top6(exch.silver)} x={exch.years} color={color} fmt={usd} />
          <Legend items={legendFor(top6(exch.silver))} />
        </Card>
        <Card title="Exchange plans offered" sub={`Individual plans filed on the ${state} exchange, by plan year: expansion or retreat.`} href={`/products?state=${state}`} cta="Products">
          <LineChart series={top6(exch.plans)} x={exch.years} color={color} fmt={(v) => String(Math.round(v))} yZero />
          <Legend items={legendFor(top6(exch.plans))} />
        </Card>
      </div>

      <h2 className="font-mono text-xs uppercase tracking-wide text-stone-500">Network negotiations</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Hospital prices as a multiple of Medicare" sub={`Median across hospitals each carrier prices, common services${net.month ? `, ${net.month}` : ""}. Lower = stronger negotiating position.`} href="/leverage" cta="Leverage">
          <HBars rows={net.position.slice(0, 12).map((p) => ({ name: p.name, values: [p.median], note: `${p.hospitals} hospitals` }))} keys={["× Medicare"]} colors={["#2a78d6"]} fmt={(v) => `${v.toFixed(2)}×`} reference={{ value: 1, label: "Medicare" }} />
        </Card>
        <Card title="Negotiated-rate and network moves · 12 months" sub="Detected month over month in carriers' rate files: provider rates up or down, hospitals added or dropped." href="/updates?view=market&cat=network&days=365" cta="Changes">
          {net.moves.length ? (
            <>
              <HBars rows={net.moves.slice(0, 10).map((m) => ({ name: m.name, values: [m.up, -m.down, m.adds, -m.drops] }))} keys={["Rates up", "Rates down", "Hospitals added", "Hospitals dropped"]} colors={["#eb6834", "#2a78d6", "#1baf7a", "#e34948"]} fmt={(v) => String(Math.abs(v))} reference={{ value: 0, label: "" }} />
              <Legend items={[{ name: "Rates up", color: "#eb6834" }, { name: "Rates down", color: "#2a78d6" }, { name: "Hospitals added", color: "#1baf7a" }, { name: "Hospitals dropped", color: "#e34948" }]} />
            </>
          ) : <p className="text-xs text-stone-500">Moves appear once two months of rate files are on hand.</p>}
        </Card>
      </div>

      <h2 className="font-mono text-xs uppercase tracking-wide text-stone-500">Sales</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`Employer accounts won and lost · ${sales.years}`} sub="Covered lives moving between insured carriers (Form 5500, 100+ participant plans)." href="/updates?view=market&cat=sales&days=365" cta="Account moves" className="lg:col-span-2">
          {sales.rows.length ? (
            <>
              <HBars rows={sales.rows.slice(0, 10).map((r) => ({ name: r.name, values: [r.wonLives, -r.lostLives], note: `${r.won} won, ${r.lost} lost` }))} keys={["Lives won", "Lives lost"]} colors={["#1baf7a", "#e34948"]} fmt={lives} reference={{ value: 0, label: "" }} />
              <Legend items={[{ name: "Lives won", color: "#1baf7a" }, { name: "Lives lost", color: "#e34948" }]} />
            </>
          ) : <p className="text-xs text-stone-500">No account moves for your competitors yet.</p>}
        </Card>
        <Card title="Renewing in 90 days · in play" sub={`Competitor-held accounts in ${state} with switching signals.`} href="/accounts" cta="Accounts">
          {hot.length ? (
            <ul className="divide-y divide-stone-100 text-sm">
              {hot.slice(0, 6).map((r) => (
                <li key={`${r.ein}${r.planNum}`} className="py-1.5">
                  <Link href={`/employers?q=${encodeURIComponent(r.sponsor)}`} className="font-medium hover:underline">{r.sponsor}</Link>
                  <p className="text-[11px] text-stone-500">{r.competitorName ?? r.carrier} · {(r.persons ?? r.participants ?? 0).toLocaleString()} covered · {r.daysOut} days</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-stone-500">None with strong signals.</p>}
        </Card>
      </div>

      <h2 className="font-mono text-xs uppercase tracking-wide text-stone-500">Product, pricing and network news · competitors</h2>
      <Card title="Latest from your competitors" sub="Product launches, pricing and network news from the last 60 days. Everything else is in Updates." href="/updates?cat=product" cta="All product news">
        {productNews.length ? (
          <ul className="divide-y divide-stone-100">
            {productNews.map((s) => (
              <li key={s.id} className="py-2">
                <p className="text-[11px] text-stone-500">{s.type.toLowerCase()} · {s.competitor?.name} · {timeAgo(s.publishedAt ?? s.createdAt)} ago</p>
                <Link href={`/signals/${s.id}`} className="text-sm font-medium leading-snug hover:underline">{s.title}</Link>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-stone-500">No product, pricing or network news in the last 60 days.</p>}
      </Card>
    </div>
  );
}
