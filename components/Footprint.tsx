import Link from "next/link";
import { footprint, SEGMENTS, type Cell, type Seg } from "@/lib/marketdata/footprint";
import { NE_STATES } from "@/lib/marketdata/products";
import { rankCompetitors } from "@/lib/homecharts";
import { colorMap, OTHER } from "@/components/viz";

const SEG_SHORT: Record<Seg, string> = { INDIVIDUAL: "Ind", SMALL_GROUP: "SG", LARGE_GROUP: "LG" };
const SEG_LONG: Record<Seg, string> = { INDIVIDUAL: "Individual", SMALL_GROUP: "Small group", LARGE_GROUP: "Large group" };
const n = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(Math.round(v)));
const pct = (v: number | null, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const lrTone = (v: number | null) => (v == null ? "text-stone-400" : v >= 0.95 ? "text-red-600" : v <= 0.8 ? "text-emerald-700" : "text-stone-600");

function Line({ seg, c, color, label = true }: { seg: Seg; c: Cell; color: string; label?: boolean }) {
  const g = c.prevLives ? c.lives / c.prevLives - 1 : null;
  return (
    <div className="grid grid-cols-[18px_1fr] items-center gap-x-1.5" title={`${SEG_LONG[seg]}: ${Math.round(c.lives).toLocaleString()} members, ${pct(c.share, 1)} of the market${g != null ? `, ${g > 0 ? "+" : ""}${Math.round(g * 100)}% y/y` : ""}; loss ratio ${pct(c.lossRatio)}`}>
      {label ? <span className="font-mono text-[9px] uppercase text-stone-400">{SEG_SHORT[seg]}</span> : <span />}
      <div>
        <div className="flex items-baseline justify-between gap-2 tabular-nums">
          <span className="font-medium text-stone-900">{pct(c.share, c.share < 0.1 ? 1 : 0)}</span>
          <span className="text-stone-500">{n(c.lives)}</span>
          <span className={lrTone(c.lossRatio)}>{pct(c.lossRatio)}</span>
        </div>
        <div className="mt-0.5 h-1 w-full rounded-full bg-stone-100"><div className="h-1 rounded-full" style={{ width: `${Math.max(2, Math.min(100, c.share * 100))}%`, background: color }} /></div>
      </div>
    </div>
  );
}

/** Competitor × state grid: share, members and loss ratio per segment; exchange participation. */
export async function Footprint({ workspaceId, seg }: { workspaceId: string; seg?: string }) {
  const [{ year, rows, totals }, ranked] = await Promise.all([footprint(workspaceId), rankCompetitors(workspaceId)]);
  if (!year || !rows.length) return null;
  const color = colorMap(ranked);
  const only = SEGMENTS.find((s) => s === seg);
  const segs = only ? [only] : SEGMENTS;
  const shown = rows.filter((r) => (only ? NE_STATES.some((st) => r.cells[st]?.[only]) : r.lives > 0) || Object.keys(r.exchange).length);
  if (only) shown.sort((a, b) => NE_STATES.reduce((t, st) => t + (b.cells[st]?.[only]?.lives ?? 0), 0) - NE_STATES.reduce((t, st) => t + (a.cells[st]?.[only]?.lives ?? 0), 0));
  const hidden = rows.length - shown.length;
  const chip = (on: boolean) => `rounded px-2.5 py-1 ${on ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-semibold tracking-tight">Where they compete · {year}</h2>
          <p className="max-w-3xl text-xs text-stone-500">Fully insured members by state and segment, each carrier&apos;s share of that state-segment market (bar), and loss ratio (claims ÷ premium; red ≥ 95%, green ≤ 80%). <span className="rounded bg-sky-50 px-1 text-sky-800">Ex</span> = sells on the state&apos;s exchange (I individual, S small group). Hover a cell for detail.</p>
        </div>
        <div className="flex gap-1 text-xs">
          <Link href="/competitors" className={chip(!only)}>All segments</Link>
          {SEGMENTS.map((s) => <Link key={s} href={`/competitors?seg=${s}`} className={chip(only === s)}>{SEG_LONG[s]}</Link>)}
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-xs" data-static>
          <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2">Competitor</th>
              <th className="px-3 py-2">New England{only ? ` · ${SEG_SHORT[only]}` : ""}</th>
              {NE_STATES.map((st) => (
                <th key={st} className="min-w-[112px] px-2 py-2">
                  {st}
                  <div className="font-sans text-[9px] normal-case tracking-normal text-stone-400">{segs.map((s) => `${SEG_SHORT[s]} ${n(totals.get(`${st}|${s}`) ?? 0)}`).join(" · ")}</div>
                </th>
              ))}
            </tr>
            <tr className="border-t border-stone-100 text-[9px] normal-case tracking-normal text-stone-400"><th /><th className="px-3 pb-1 font-normal">share · members · loss ratio</th>{NE_STATES.map((st) => <th key={st} className="px-2 pb-1 font-normal">share · members · LR</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {shown.map((r) => {
              const c = color(r.id);
              const tot = only ? NE_STATES.reduce((a, st) => { const x = r.cells[st]?.[only]; return x ? { lives: a.lives + x.lives, lrN: a.lrN + (x.lossRatio ?? 0) * x.lives, lrD: a.lrD + (x.lossRatio != null ? x.lives : 0) } : a; }, { lives: 0, lrN: 0, lrD: 0 }) : null;
              const segTotal = only ? NE_STATES.reduce((s, st) => s + (totals.get(`${st}|${only}`) ?? 0), 0) : 0;
              return (
                <tr key={r.id} className="align-top">
                  <td className="max-w-[150px] px-2 py-2">
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: c === OTHER ? "#d6d3d1" : c }} />
                    <Link href={`/competitors/${r.id}`} className="font-medium text-stone-900 hover:underline">{r.name}</Link>
                    <div className="pl-4 text-[10px] text-stone-400">T{r.tier} · {r.states} state{r.states === 1 ? "" : "s"}</div>
                  </td>
                  <td className="min-w-[112px] px-2 py-2 tabular-nums">
                    {tot ? (tot.lives ? <><div className="text-sm font-semibold">{n(tot.lives)}</div><div className="text-stone-500">{pct(tot.lives / (segTotal || 1), 1)} share · <span className={lrTone(tot.lrD ? tot.lrN / tot.lrD : null)}>LR {pct(tot.lrD ? tot.lrN / tot.lrD : null)}</span></div></> : <span className="text-stone-300">—</span>)
                      : r.lives ? <><div className="text-sm font-semibold">{n(r.lives)}</div><div className="text-stone-500">{pct(r.share, 1)} share{r.growth != null ? <> · <span className={r.growth >= 0 ? "text-emerald-700" : "text-red-600"}>{r.growth > 0 ? "+" : ""}{Math.round(r.growth * 100)}% y/y</span></> : null}</div><div className={lrTone(r.lossRatio)}>LR {pct(r.lossRatio)}</div></> : <span className="text-stone-300">No fully insured filings</span>}
                  </td>
                  {NE_STATES.map((st) => {
                    const cell = r.cells[st] ?? {};
                    const ex: string[] = r.exchange[st] ?? [];
                    const lines = segs.filter((s) => cell[s]);
                    return (
                      <td key={st} className={`px-2 py-2 ${lines.length ? "" : "text-stone-300"}`}>
                        <div className="space-y-1.5">
                          {lines.map((s) => <Line key={s} seg={s} c={cell[s]!} color={c} label={!only} />)}
                          {!lines.length && !ex.length && "—"}
                          {ex.length > 0 && (!only || only !== "LARGE_GROUP") && <span className="inline-block rounded bg-sky-50 px-1 text-[10px] text-sky-800" title={`On the ${st} exchange: ${ex.join(", ")}`}>Ex {ex.map((e: string) => (e === "SHOP" ? "S" : "I")).sort().join("+")}</span>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-stone-400">CMS medical loss-ratio filings, {year} (comprehensive major medical, fully insured; self-funded/ASO members aren&apos;t in these filings). Loss ratio here is raw claims ÷ premium, not the regulatory MLR with its quality and tax adjustments. Exchange participation from the latest plan-year files.{hidden ? ` ${hidden} tracked competitor${hidden === 1 ? " has" : "s have"} no ${only ? SEG_LONG[only].toLowerCase() : "New England"} filings and ${hidden === 1 ? "is" : "are"} left out.` : ""}</p>
    </section>
  );
}
