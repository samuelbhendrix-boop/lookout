import Link from "next/link";
import { launchReport, THEMES, type Launch } from "@/lib/reports/launches";
import { LaunchesRead } from "@/components/reports/LaunchesRead";
import { NotIncluded } from "@/components/NotIncluded";
import { Empty } from "@/components/ui";
import { fmtInt } from "@/components/charts";
import { FilterBar } from "@/components/FilterBar";
import { Suspense } from "react";
import { LargeGroupLaunches } from "@/components/reports/LargeGroupLaunches";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Product launches · Reports" };

const LABEL = Object.fromEntries(THEMES.map((t) => [t.id, t.label])) as Record<string, string>;
const mk = (m: string) => (m === "Individual" ? "Ind" : "SG");
const pct = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const idx = (l: Launch) => (l.premium && l.marketPremium ? l.premium / l.marketPremium : null);
const measured = (l: Launch) => l.laterEnrolled ?? l.nextEnrolled;

function Themes({ l }: { l: Launch }) {
  return <div className="flex flex-wrap gap-1">{l.themes.map((t) => <span key={t} className="rounded bg-stone-100 px-1 text-[10px] text-stone-600">{LABEL[t]}</span>)}</div>;
}

export default async function LaunchesReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const r = await launchReport();
  if (!r) return <div className="space-y-4"><h1 className="h1">Product launches</h1><Empty title="No rate filings yet">CMS rate filings import in the background; check System status.</Empty></div>;
  const states = [...new Set(r.launches.map((l) => l.state))].sort();
  const st = states.includes(sp.state ?? "") ? sp.state! : null;
  // Filters (all in the URL): carrier, segment, plan year, product kind; plus entry/exit and size for the moves table.
  const brands = [...new Set([...r.launches.map((l) => l.brand), ...r.moves.map((m) => m.brand)])].sort((a, b) => a.localeCompare(b));
  const session = (await getSession())!;
  const lgMode = sp.segment === "LG";
  const compNames = lgMode ? (await db.competitor.findMany({ where: { workspaceId: session.workspaceId }, select: { name: true }, orderBy: { name: "asc" } })).map((c) => c.name) : [];
  const carrier = (lgMode ? compNames : brands).includes(sp.carrier ?? "") ? sp.carrier! : null;
  const seg = sp.segment === "Individual" || sp.segment === "SG" || sp.segment === "LG" ? sp.segment : null;
  const segOk = (market: string) => !seg || (seg === "Individual" ? market === "Individual" : market !== "Individual");
  const yr = r.years.includes(Number(sp.year)) ? Number(sp.year) : null;
  const kind = THEMES.some((t) => t.id === sp.kind) ? sp.kind! : null;
  const L = r.launches.filter((l) => (!st || l.state === st) && (!carrier || l.brand === carrier) && segOk(l.market) && (!yr || l.year === yr) && (!kind || (l.themes as string[]).includes(kind)));
  const M = r.moves.filter((m) => (!st || m.state === st) && (!carrier || m.brand === carrier) && segOk(m.market) && (!yr || m.year === yr));
  const move = sp.move === "entry" || sp.move === "exit" ? sp.move : null;
  const minSize = Number(sp.min) || 0;
  const filtered = !!(carrier || seg || yr || kind);
  const qsKeep = (extra: Record<string, string | null>) => { const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]); for (const [k, v] of Object.entries(extra)) { if (v) q.set(k, v); else q.delete(k); } return `/reports/launches${q.size ? `?${q}` : ""}`; };
  const last = r.years.at(-1)!;
  const winners = L.filter((l) => !l.migrated && (measured(l) ?? 0) > 0).sort((a, b) => measured(b)! - measured(a)!).slice(0, st ? 20 : 25);
  const net = L.filter((l) => !l.migrated && measured(l) != null);
  const hit = net.length ? net.filter((l) => measured(l)! >= 5000).length / net.length : null;
  const pipeline = L.filter((l) => l.year === last).sort((a, b) => b.themes.length - a.themes.length || b.plans - a.plans);
  const migrated = L.filter((l) => l.migrated).sort((a, b) => (measured(b) ?? 0) - (measured(a) ?? 0)).slice(0, 10);
  const chip = (on: boolean) => `rounded px-2 py-1 ${on ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`;
  const ne = ["MA", "CT", "RI", "NH", "VT", "ME"];
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-wide text-stone-500">Reports</p>
        <h1 className="h1">{lgMode ? "New large-group and self-funded products" : `New commercial products, ${r.years[0]}–${last}`}</h1>
        {!lgMode && <p className="max-w-3xl text-sm text-stone-500">Every new individual and small-group product filed in every state, which ones took off, what kind of product they are, and who entered or left which markets. From CMS&apos;s rate-review files for plan years {r.years.join(", ")}; rebuilt automatically when a new year&apos;s filings arrive.</p>}
        {!lgMode && <div className="mt-3 flex flex-wrap items-center gap-1 text-xs">
          <Link href={qsKeep({ state: null })} className={chip(!st)}>All states</Link>
          <span className="mx-1 text-stone-300">|</span>
          {ne.filter((s) => states.includes(s)).map((s) => <Link key={s} href={qsKeep({ state: s })} className={chip(st === s)}>{s}</Link>)}
          <span className="mx-1 text-stone-300">|</span>
          {states.filter((s) => !ne.includes(s)).map((s) => <Link key={s} href={qsKeep({ state: s })} className={chip(st === s)}>{s}</Link>)}
        </div>}
        <div className="mt-2">
          <Suspense>
            <FilterBar filters={[
              { key: "carrier", label: "Carrier", options: (lgMode ? compNames : brands).map((b) => ({ value: b, label: b })) },
              { key: "segment", label: "Segment", options: [{ value: "Individual", label: "Individual" }, { value: "SG", label: "Small group" }, { value: "LG", label: "Large group & self-funded" }] },
              ...(lgMode ? [] : [
                { key: "year", label: "Plan year", options: r.years.map((y) => ({ value: String(y), label: String(y) })) },
                { key: "kind", label: "Product kind", options: THEMES.map((t) => ({ value: t.id, label: t.label })) },
              ]),
            ]} />
          </Suspense>
        </div>
      </div>

      {seg === "LG" ? <LargeGroupLaunches workspaceId={session.workspaceId} carrier={carrier} /> : <>
      {!st && !filtered && <LaunchesRead />}

      <section className="grid gap-3 sm:grid-cols-3">
        {r.byYear.filter((y) => !yr || y.year === yr).map((y) => {
          const ls = L.filter((l) => l.year === y.year), ms = M.filter((m) => m.year === y.year);
          return (
            <div key={y.year} className="card p-4">
              <p className="font-mono text-[11px] uppercase tracking-wide text-stone-500">Plan year {y.year}{st ? ` · ${st}` : ""}{carrier ? ` · ${carrier}` : ""}{seg ? ` · ${seg === "SG" ? "small group" : "individual"}` : ""}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{ls.length} <span className="text-sm font-normal text-stone-500">new products</span></p>
              <p className="text-xs text-stone-500">{ls.filter((l) => !l.migrated).length} genuinely new · {ls.filter((l) => l.migrated).length} re-filed existing members · {ls.filter((l) => l.market === "Individual").length} individual, {ls.filter((l) => l.market !== "Individual").length} small group</p>
              {y.year > r.years[0] && <p className="mt-2 text-sm"><span className="text-emerald-700">{ms.filter((m) => m.kind === "entry").length} market entries</span> · <span className="text-red-600">{ms.filter((m) => m.kind === "exit").length} exits</span></p>}
            </div>
          );
        })}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Which launches took off</h2>
        <p className="text-xs text-stone-500">Genuinely new products ranked by members in the latest filing that reports them (a product launched for {r.years[0]} shows its members in the {r.years[0] + 1} and {r.years[0] + 2} filings). {hit != null && <>Only {pct(hit)} of {net.length} measurable launches{st ? ` in ${st}` : ""} reached 5,000 members; the median reached {fmtInt(median(net.map((l) => measured(l)!)) ?? 0)}.</>} Price index = projected premium per member vs the state-market median (100 = median).</p>
        {winners.length ? (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Product</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Launched</th><th className="px-3 py-2 text-right">Members, next filing</th><th className="px-3 py-2 text-right">Year after</th><th className="px-3 py-2 text-right">Share</th><th className="px-3 py-2 text-right">Price idx</th><th className="px-3 py-2">Kind</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {winners.map((l) => (
                  <tr key={`${l.year}${l.productId}`} className="align-top">
                    <td className="max-w-[260px] px-3 py-1.5"><span className="font-medium">{l.name}</span><div className="text-[10px] text-stone-500">{l.planType} · {l.plans} plans · {l.metals.join("/")}</div></td>
                    <td className="max-w-[180px] px-3 py-1.5 text-xs">{l.brand}<div className="text-[10px] text-stone-400">{l.company}</div></td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs">{l.year} · {l.state} {mk(l.market)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(l.nextEnrolled)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{l.laterEnrolled != null ? fmtInt(l.laterEnrolled) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{pct(l.share, 1)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${(idx(l) ?? 1) <= 0.95 ? "text-emerald-700" : (idx(l) ?? 1) >= 1.1 ? "text-red-600" : ""}`}>{idx(l) != null ? Math.round(idx(l)! * 100) : "—"}</td>
                    <td className="px-3 py-1.5"><Themes l={l} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-stone-500">No measurable new launches{st ? ` in ${st}` : ""} yet.</p>}
      </section>

      {!st && !filtered && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">What kinds of products launch, and which work</h2>
          <p className="text-xs text-stone-500">Kind is read from product and plan names, so it only catches designs carriers name (a product can be several kinds). Genuinely new launches only; &quot;reached 5K&quot; = share of measurable launches with 5,000+ members.</p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Kind</th>{r.years.map((y) => <th key={y} className="px-3 py-2 text-right">{y}</th>)}<th className="px-3 py-2 text-right">Measured</th><th className="px-3 py-2 text-right">Median members</th><th className="px-3 py-2 text-right">Reached 5K</th><th className="px-3 py-2">Biggest</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {r.themes.map((t) => (
                  <tr key={t.id} className="align-top">
                    <td className="max-w-[260px] px-3 py-1.5"><span className="font-medium">{t.label}</span><div className="text-[10px] text-stone-500">{t.about}</div></td>
                    {r.years.map((y) => <td key={y} className="px-3 py-1.5 text-right tabular-nums">{t.byYear[y] || "—"}</td>)}
                    <td className="px-3 py-1.5 text-right tabular-nums">{t.measured}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{t.medianEnrolled != null ? fmtInt(Math.round(t.medianEnrolled)) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{pct(t.hitRate)}</td>
                    <td className="px-3 py-1.5 text-xs text-stone-600">{t.topExample ? `${t.topExample.name} (${t.topExample.brand}, ${t.topExample.state} ${t.topExample.year}) · ${fmtInt(measured(t.topExample))}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Filed for {last}: the pipeline{st ? ` · ${st}` : ""}</h2>
        <p className="text-xs text-stone-500">New products in the {last} filings, no enrollment yet. Most distinctive first (more kinds, then more plans). Example plan names show what the carrier is selling.</p>
        {pipeline.length ? (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Product</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Where</th><th className="px-3 py-2 text-right">Plans</th><th className="px-3 py-2 text-right">Price idx</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Example plans</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {pipeline.slice(0, st ? 60 : 50).map((l) => (
                  <tr key={l.productId} className="align-top">
                    <td className="max-w-[220px] px-3 py-1.5 font-medium">{l.name}<div className="text-[10px] font-normal text-stone-500">{l.planType} · {l.onExchange ? `${l.onExchange} on exchange` : "off-exchange"}</div></td>
                    <td className="max-w-[160px] px-3 py-1.5 text-xs">{l.brand}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs">{l.state} {mk(l.market)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{l.plans}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{idx(l) != null ? Math.round(idx(l)! * 100) : "—"}</td>
                    <td className="px-3 py-1.5"><Themes l={l} /></td>
                    <td className="max-w-[340px] px-3 py-1.5 text-[11px] text-stone-600">{l.examples.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pipeline.length > (st ? 60 : 50) && <p className="border-t border-stone-100 px-3 py-1.5 text-[11px] text-stone-500">{pipeline.length - (st ? 60 : 50)} more; pick a state to see them all.</p>}
          </div>
        ) : <p className="text-sm text-stone-500">No new products filed{st ? ` in ${st}` : ""} for {last}.</p>}
      </section>

      <section id="moves" className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Who entered and who left</h2>
        <p className="text-xs text-stone-500">A carrier selling in a state and market it didn&apos;t the year before, or no longer selling where it did. Members = its enrollment in the filing before it left (or its first filing after entering). Renames and moves between a carrier&apos;s own legal entities are left out. Uses the filters above (state, carrier, segment, plan year), plus:</p>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {([[null, "Entries and exits"], ["exit", "Exits only"], ["entry", "Entries only"]] as const).map(([v, l]) => <Link key={l} href={`${qsKeep({ move: v })}#moves`} scroll={false} className={chip(move === v)}>{l}</Link>)}
          <span className="mx-1 text-stone-300">|</span>
          {([[0, "Any size"], [1000, "1K+ members"], [10000, "10K+"], [50000, "50K+"]] as const).map(([v, l]) => <Link key={l} href={`${qsKeep({ min: v ? String(v) : null })}#moves`} scroll={false} className={chip(minSize === v)}>{l}</Link>)}
        </div>
        {(() => {
          const xs = M.filter((m) => (!move || m.kind === move) && m.enrolled >= minSize).sort((a, b) => b.year - a.year || b.enrolled - a.enrolled);
          const sum = (k: "entry" | "exit") => xs.filter((m) => m.kind === k);
          const byYear = r.years.slice(1).map((y) => ({ y, e: sum("entry").filter((m) => m.year === y), x: sum("exit").filter((m) => m.year === y) }));
          return (
            <>
              <div className="flex flex-wrap gap-4 text-sm">
                {byYear.filter((b) => !yr || b.y === yr).map((b) => <span key={b.y}><span className="font-mono text-[11px] text-stone-500">{b.y}</span> <span className="text-emerald-700">{b.e.length} in ({fmtInt(b.e.reduce((t, m) => t + m.enrolled, 0))})</span> · <span className="text-red-600">{b.x.length} out ({fmtInt(b.x.reduce((t, m) => t + m.enrolled, 0))})</span></span>)}
              </div>
              <div className="card max-h-[520px] overflow-auto">
                <table className="w-full text-xs" data-static>
                  <thead className="sticky top-0 border-b border-stone-200 bg-white text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Year</th><th className="px-3 py-2">Move</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Segment</th><th className="px-3 py-2 text-right">Members</th><th className="px-3 py-2 text-right">Products</th></tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {xs.slice(0, 500).map((m) => (
                      <tr key={`${m.year}${m.state}${m.market}${m.brand}${m.kind}`}>
                        <td className="px-3 py-1 tabular-nums text-stone-500">{m.year}</td>
                        <td className={`px-3 py-1 font-medium ${m.kind === "exit" ? "text-red-700" : "text-emerald-700"}`}>{m.kind === "exit" ? "Exit" : "Entry"}</td>
                        <td className="px-3 py-1"><Link href={`${qsKeep({ carrier: m.brand })}#moves`} scroll={false} className="hover:underline">{m.brand}</Link></td>
                        <td className="px-3 py-1"><Link href={`${qsKeep({ state: m.state })}#moves`} scroll={false} className="hover:underline">{m.state}</Link></td>
                        <td className="px-3 py-1">{m.market === "Individual" ? "Individual" : "Small group"}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{m.enrolled ? fmtInt(m.enrolled) : "—"}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{m.products || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!xs.length && <p className="px-3 py-2 text-stone-500">None for these filters.</p>}
                {xs.length > 500 && <p className="border-t border-stone-100 px-3 py-1.5 text-[11px] text-stone-500">Showing 500 of {xs.length}; narrow the filters to see the rest.</p>}
              </div>
            </>
          );
        })()}
      </section>

      {!st && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">Most active launchers</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Carrier</th><th className="px-3 py-2 text-right">New products</th><th className="px-3 py-2 text-right">States</th><th className="px-3 py-2 text-right">Members won by new launches</th><th className="px-3 py-2 text-right">Entries</th><th className="px-3 py-2 text-right">Exits</th><th className="px-3 py-2">Best launch</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {r.brands.slice(0, 30).map((b) => (
                  <tr key={b.brand}><td className="px-3 py-1.5 font-medium">{b.brand}</td><td className="px-3 py-1.5 text-right tabular-nums">{b.launches}</td><td className="px-3 py-1.5 text-right tabular-nums">{b.states}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(b.netNewEnrolled || null)}</td><td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{b.entries || "—"}</td><td className="px-3 py-1.5 text-right tabular-nums text-red-600">{b.exits || "—"}</td><td className="px-3 py-1.5 text-xs text-stone-600">{b.best && measured(b.best) ? `${b.best.name} (${b.best.state} ${b.best.year}) · ${fmtInt(measured(b.best))}` : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {migrated.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">New on paper only</h2>
          <p className="text-xs text-stone-500">Launches where the same carrier dropped at least half as many members from its other plans in that state and market the same year: existing members re-filed into a new product or legal entity. Kept out of the rankings above.</p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Product</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Launched</th><th className="px-3 py-2 text-right">Members after</th><th className="px-3 py-2 text-right">Members moved out of other plans</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {migrated.map((l) => <tr key={`${l.year}${l.productId}`}><td className="px-3 py-1.5">{l.name}</td><td className="px-3 py-1.5 text-xs">{l.brand}</td><td className="px-3 py-1.5 text-xs">{l.year} · {l.state} {mk(l.market)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(measured(l))}</td><td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{fmtInt(l.brandTerminated)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>
      )}

      </>}

      <NotIncluded items={[
        <>ACA individual and small-group products only (the rate-review filings). Large-group, self-funded and Medicare products aren&apos;t filed this way. ICHRA/CHOICE enrollment buys individual plans, so it&apos;s inside the individual numbers but can&apos;t be separated.</>,
        <>Members are the enrollment each carrier reports when it files (months before the plan year), so a launch&apos;s first real count is in the next year&apos;s filing, and the latest year has none yet.</>,
        <>The newest year&apos;s file is CMS&apos;s first release; a carrier whose filing wasn&apos;t final may be missing and look like an exit until CMS republishes (the import picks up republished files automatically).</>,
        <>&quot;Kind&quot; is inferred from product and plan names. A design the carrier doesn&apos;t name (say, $0 primary care described only in the plan document) isn&apos;t caught.</>,
        <>Carriers are grouped by parent where the subsidiary names make it clear (Centene, Elevance, UnitedHealthcare, HCSC and others); unfamiliar subsidiaries stay under their own name.</>,
      ]} />
    </div>
  );
}
