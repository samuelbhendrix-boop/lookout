import Link from "next/link";
import { competitorDossier, stateMatrix, strategyNarrative, type Product, type Tag } from "@/lib/marketdata/dossier";
import { productNews } from "@/lib/productnews";
import { fmtInt } from "@/components/charts";

const ARCH_TONE: Record<string, string> = {
  "Share grab": "bg-emerald-50 text-emerald-800", Launch: "bg-sky-50 text-sky-800", "Building out": "bg-sky-50 text-sky-800", Growing: "bg-emerald-50 text-emerald-800",
  "Value network play": "bg-violet-50 text-violet-800", "Price competitor": "bg-violet-50 text-violet-800",
  "Margin repair": "bg-amber-50 text-amber-800", Harvest: "bg-amber-50 text-amber-800", "Raising price": "bg-amber-50 text-amber-800",
  Exit: "bg-red-50 text-red-800", "Wind-down": "bg-red-50 text-red-800", "Losing ground": "bg-red-50 text-red-800",
  "Defend the core": "bg-stone-100 text-stone-700", Steady: "bg-stone-100 text-stone-500",
};
const TAG_TONE: Record<Tag["tone"], string> = { good: "border-emerald-200 text-emerald-800", bad: "border-red-200 text-red-700", neutral: "border-stone-200 text-stone-600" };
const SEG: Record<string, string> = { INDIVIDUAL: "Individual", SMALL_GROUP: "Small group", LARGE_GROUP: "Large group" };
const pc = (x: number | null | undefined, signed = true) => (x == null ? "—" : `${signed && x > 0 ? "+" : ""}${(x * 100).toFixed(Math.abs(x) < 0.1 && signed ? 1 : 0)}%`);
const usd = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const k = (n: number | null | undefined) => (n == null ? "—" : n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : `$${Math.round(n)}`);
const mkts = (p: Product) => (p.markets.length > 1 ? "Ind + SG" : p.markets[0] === "Small Group" ? "Small group" : p.markets[0]);

export function Archetype({ label, why }: { label: string; why?: string }) {
  return <span title={why} className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${ARCH_TONE[label] ?? "bg-stone-100"}`}>{label}</span>;
}

/** One carrier's product strategy: the read, its book by segment, and every product's dossier row. */
export async function ProductStrategy({ comp, state, workspaceId }: { comp: { id: string; name: string; aliases: string[]; issuerPattern: string | null }; state?: string; workspaceId: string }) {
  const d = await competitorDossier(comp, state);
  if (!d.products.length && !d.book.length) return null;
  const news = await productNews(workspaceId, 365, 6, comp.id);
  const narrative = await strategyNarrative(comp.id + (state ?? ""), comp.name, d, news);
  const year = d.products[0]?.planYear;
  const live = d.products.filter((p) => p.plans > 0);
  const gone = d.products.filter((p) => p.plans === 0);

  return (
    <section id="strategy" className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Product strategy{state ? ` · ${state}` : ""}</h2>
        <p className="max-w-3xl text-xs text-stone-500">Every individual and small-group product {comp.name} files, with what its price, enrollment, line-up and filed margin say about what the carrier is doing with it. Hover a label for the evidence.</p>
      </div>

      <div className="card space-y-2 p-4 text-sm">
        <p className="font-mono text-[10px] uppercase tracking-wide text-stone-500">{narrative ? "Strategy read" : "What the filings say"}</p>
        {narrative ? <p className="leading-relaxed">{narrative.text}</p> : d.summary.map((s) => <p key={s} className="leading-relaxed">{s}</p>)}
        {narrative && <details className="text-xs text-stone-500"><summary className="cursor-pointer">Rule summary it was written from</summary>{d.summary.map((s) => <p key={s} className="mt-1">{s}</p>)}</details>}
        <p className="text-[10px] text-stone-400">{narrative ? `Written by AI (${narrative.model}) from the numbers below and recent product news; check them before acting on it.` : "Written by rules from the numbers below. Add ANTHROPIC_API_KEY on the server for an analyst-style read that also weighs the news."}</p>
      </div>

      {d.book.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
              <tr><th className="px-3 py-2">Book · {d.book[0].year}</th><th className="px-3 py-2 text-right">Members</th><th className="px-3 py-2 text-right">Change</th><th className="px-3 py-2 text-right">Share</th><th className="px-3 py-2 text-right">Premium PMPM</th><th className="px-3 py-2 text-right">Market</th><th className="px-3 py-2 text-right">Loss ratio</th><th className="px-3 py-2 text-right">Market</th><th className="px-3 py-2">Read</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {d.book.map((b) => (
                <tr key={`${b.state}${b.segment}`}>
                  <td className="whitespace-nowrap px-3 py-1.5">{b.state} · {SEG[b.segment]}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(Math.round(b.lives))}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{b.livesBefore ? <span className={b.lives > b.livesBefore ? "text-emerald-700" : "text-red-600"}>{pc(b.lives / b.livesBefore - 1)}</span> : "—"}<span className="text-[10px] text-stone-400">{b.yearBefore ? ` since ${b.yearBefore}` : ""}</span></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{pc(b.share, false)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(b.pmpm)}</td><td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{usd(b.marketPmpm)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{pc(b.lossRatio, false)}</td><td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{pc(b.marketLossRatio, false)}</td>
                  <td className="px-3 py-1.5 text-xs text-stone-600">{b.read.join("; ") || "In line with market"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-stone-100 px-3 py-1.5 text-[10px] text-stone-400">CMS loss-ratio filings: fully insured comprehensive medical only; members = covered lives.</p>
        </div>
      )}

      {live.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Product · {year} filings</th><th className="px-3 py-2">Strategy</th><th className="px-3 py-2 text-right">Members</th><th className="px-3 py-2 text-right">Y/Y</th><th className="px-3 py-2 text-right">Share</th>
                <th className="px-3 py-2 text-right">Rate chg</th><th className="px-3 py-2 text-right">Mkt</th><th className="px-3 py-2 text-right">Price idx</th><th className="px-3 py-2 text-right">PMPM</th><th className="px-3 py-2 text-right">Filed LR</th><th className="px-3 py-2">Line-up and design</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {live.map((p) => (
                <tr key={p.key} className="align-top">
                  <td className="min-w-[220px] max-w-[300px] px-3 py-2">
                    <span className="font-medium">{p.name}</span>
                    <div className="text-[10px] text-stone-500">{!state && `${p.state} · `}{mkts(p)} · {p.planType ?? "—"}{p.networks.length ? ` · ${p.networks.join(", ")}` : ""}</div>
                    <div className="font-mono text-[9px] text-stone-400">{p.productIds.join(" ")}</div>
                  </td>
                  <td className="min-w-[180px] max-w-[260px] px-3 py-2">
                    <Archetype label={p.archetype.label} why={p.archetype.why} />
                    <p className="mt-0.5 text-[11px] leading-snug text-stone-600">{p.archetype.why}</p>
                    <div className="mt-1 flex flex-wrap gap-1">{p.tags.filter((t) => !p.archetype.why.includes(t.why)).map((t) => <span key={t.id} title={t.why} className={`rounded border px-1 text-[10px] ${TAG_TONE[t.tone]}`}>{t.label}</span>)}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(p.enrolled || null)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${p.growth == null ? "" : p.growth >= 0.1 ? "text-emerald-700" : p.growth <= -0.1 ? "text-red-600" : ""}`}>{pc(p.growth)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.share ? pc(p.share, false) : "—"}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${p.rateChange != null && p.marketRateChange != null ? (p.rateChange - p.marketRateChange >= 0.02 ? "text-red-600" : p.rateChange - p.marketRateChange <= -0.02 ? "text-emerald-700" : "") : ""}`}>{pc(p.rateChange)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-500">{pc(p.marketRateChange)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${p.priceIndex == null ? "" : p.priceIndex <= 0.95 ? "text-emerald-700" : p.priceIndex >= 1.1 ? "text-red-600" : ""}`} title="Average of its exchange plans' premium (age 40) ÷ market median for the same metal; 100 = median">{p.priceIndex != null ? Math.round(p.priceIndex * 100) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(p.pmpm)}<div className="text-[10px] text-stone-400">mkt {usd(p.marketPmpm)}</div></td>
                  <td className="px-3 py-2 text-right tabular-nums">{pc(p.filedLossRatio, false)}</td>
                  <td className="min-w-[180px] px-3 py-2 text-xs text-stone-600">
                    {p.plans} plans{p.newPlans ? <span className="text-emerald-700"> +{p.newPlans} new</span> : ""}{p.terminated ? <span className="text-red-600"> −{p.terminated} cut</span> : ""} · <span title={p.metals.join(", ")}>{p.metals.map((m) => m === "Catastrophic" ? "Cat" : m[0]).join("/")}</span>
                    <div className="text-[11px] text-stone-500">
                      {p.onExchange ? `${p.onExchange} on exchange` : "off-exchange only"}
                      {p.dedMin != null ? ` · ded ${k(p.dedMin)}${p.dedMax !== p.dedMin ? `–${k(p.dedMax)}` : ""}` : ""}
                      {p.hsa ? ` · ${p.hsa} HSA` : ""}{p.tiered ? ` · ${p.tiered} tiered` : ""}{p.oon ? ` · ${p.oon} OON` : ""}{p.standardized ? ` · ${p.standardized} standardized` : ""}
                      {p.statewide ? " · statewide" : p.counties ? ` · ${p.counties} counties` : ""}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {gone.length > 0 && (
        <p className="text-sm"><span className="font-medium text-red-700">Discontinued for {year}:</span> {gone.map((p) => `${p.name} (${!state ? `${p.state} ` : ""}${mkts(p)}, ${p.terminated} plans${p.enrolledPrev ? `, had ${fmtInt(p.enrolledPrev)} members` : ""})`).join("; ")}.</p>
      )}
      <p className="text-[11px] text-stone-500">
        Members = enrollment the carrier filed with its rates (a snapshot months before the plan year). Rate chg = enrollment-weighted increase on renewing plans; Mkt = the same across every carrier in the state and market. Price idx = exchange premiums vs the market median for the same metal (100 = median, lower = cheaper). Filed LR = the loss ratio the carrier projects in its rate filing; low means priced for margin.
      </p>
    </section>
  );
}

/** Products tab: one row per carrier in a state, with its dominant moves. */
export async function ProductMatrix({ workspaceId, state }: { workspaceId: string; state: string }) {
  const rows = await stateMatrix(workspaceId, state);
  if (!rows.length) return null;
  const year = rows.find((r) => r.top)?.top?.planYear;
  return (
    <section className="space-y-2">
      <div>
        <h2 className="font-semibold tracking-tight">Who is doing what · {state} individual and small group, {year} filings</h2>
        <p className="text-xs text-stone-500">Each carrier&apos;s products read from its rate filings and exchange plans: growth, renewal pricing against the market, price position and line-up changes. Open a carrier for every product.</p>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
            <tr><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Main moves</th><th className="px-3 py-2 text-right">Members</th><th className="px-3 py-2 text-right">Y/Y</th><th className="px-3 py-2 text-right">Rate chg</th><th className="px-3 py-2 text-right">Mkt</th><th className="px-3 py-2 text-right">Price idx</th><th className="px-3 py-2 text-right">Plans</th><th className="px-3 py-2">Largest product</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r) => (
              <tr key={r.id || r.name} className="align-top">
                <td className="max-w-[200px] px-3 py-1.5">{r.id ? <Link className="font-medium hover:underline" href={`/competitors/${r.id}/products?state=${state}#strategy`}>{r.name}</Link> : <span className="text-stone-500">{r.name}</span>}</td>
                <td className="px-3 py-1.5"><div className="flex flex-wrap gap-1">{r.lead.length ? r.lead.map((l) => <Archetype key={l} label={l} />) : <Archetype label="Steady" />}</div></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(r.enrolled || null)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${r.growth == null ? "" : r.growth >= 0.1 ? "text-emerald-700" : r.growth <= -0.1 ? "text-red-600" : ""}`}>{pc(r.growth)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{pc(r.rateChange)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{pc(r.marketRateChange)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.priceIndex != null ? Math.round(r.priceIndex * 100) : "—"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{r.plans}{r.newPlans ? <span className="text-emerald-700"> +{r.newPlans}</span> : ""}{r.terminated ? <span className="text-red-600"> −{r.terminated}</span> : ""}</td>
                <td className="px-3 py-1.5 text-xs text-stone-600">{r.top ? <>{r.top.name} <Archetype label={r.top.archetype.label} why={r.top.archetype.why} /></> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
