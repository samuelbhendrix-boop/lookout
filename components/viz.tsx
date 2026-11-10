/**
 * Small SVG charts drawn on the server (no chart library). Colors follow the entity, not its rank: each competitor
 * gets a categorical slot from a stable key (its id), and "Market" is always a neutral dashed line. Hover tooltips are
 * native SVG titles. Palette: the validated 8-slot categorical set (light surface).
 */
export const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const INK = { primary: "#1c1917", secondary: "#57534e", muted: "#a8a29e", grid: "#e7e5e4", market: "#78716c" };

export const OTHER = "#d6d3d1";
/**
 * Stable color per competitor. `ranked` = competitor ids, biggest first (rankCompetitors): the first eight get the eight
 * categorical slots, in order, everywhere in the app; the rest are "other" gray. Hues are never cycled.
 */
export function colorMap(ranked: string[]) {
  const order = [...new Set(ranked)];
  return (id: string | undefined) => { if (id == null) return INK.market; const i = order.indexOf(id); return i >= 0 && i < CATEGORICAL.length ? CATEGORICAL[i] : OTHER; };
}
export const hasColor = (ranked: string[], id?: string) => !!id && ranked.indexOf(id) >= 0 && ranked.indexOf(id) < CATEGORICAL.length;

function niceTicks(min: number, max: number, n = 4) {
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0)!;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export function Legend({ items }: { items: Array<{ name: string; color: string; dashed?: boolean }> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-600">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5">
          <svg width="14" height="8" aria-hidden><line x1="1" y1="4" x2="13" y2="4" stroke={i.color} strokeWidth="2.5" strokeDasharray={i.dashed ? "3 2" : undefined} strokeLinecap="round" /></svg>
          {i.name}
        </span>
      ))}
    </div>
  );
}

/** Lines over categorical x (years, months). Gaps where y is null. */
export function LineChart({ series, x, color, fmt, height = 200, yZero = false }: {
  series: Array<{ name: string; competitorId?: string; points: Array<{ x: string; y: number | null }> }>;
  x: string[]; color: (id?: string) => string; fmt: (v: number) => string; height?: number; yZero?: boolean;
}) {
  const W = 560, H = height, L = 48, R = 112, T = 10, B = 24;
  const vals = series.flatMap((s) => s.points.map((p) => p.y)).filter((v): v is number => v != null);
  if (!vals.length || x.length < 2) return <p className="text-xs text-stone-500">Not enough history yet.</p>;
  const ticks = niceTicks(yZero ? 0 : Math.min(...vals), Math.max(...vals));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const px = (i: number) => L + (i * (W - L - R)) / (x.length - 1);
  const py = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  // Direct labels at the line ends, nudged apart.
  const ends = series.map((s) => { const last = [...s.points].reverse().find((p) => p.y != null); return { s, y: last ? py(last.y!) : null, v: last?.y ?? null }; }).filter((e) => e.y != null).sort((a, b) => a.y! - b.y!);
  for (let i = 1; i < ends.length; i++) if (ends[i].y! - ends[i - 1].y! < 10) ends[i].y = ends[i - 1].y! + 10;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={py(t)} y2={py(t)} stroke={INK.grid} /><text x={L - 6} y={py(t) + 3} textAnchor="end" fontSize="10" fill={INK.secondary}>{fmt(t)}</text></g>)}
      {x.map((label, i) => <text key={label} x={px(i)} y={H - 8} textAnchor="middle" fontSize="10" fill={INK.secondary}>{label}</text>)}
      {series.map((s) => {
        const c = color(s.competitorId);
        const segs: string[] = [];
        let cur = "";
        s.points.forEach((p, i) => { if (p.y == null) { if (cur) segs.push(cur); cur = ""; } else cur += `${cur ? "L" : "M"}${px(i)},${py(p.y)}`; });
        if (cur) segs.push(cur);
        return (
          <g key={s.name}>
            {segs.map((d, i) => <path key={i} d={d} fill="none" stroke={c} strokeWidth="2" strokeDasharray={s.competitorId ? undefined : "4 3"} strokeLinejoin="round" strokeLinecap="round" />)}
            {s.points.map((p, i) => p.y == null ? null : (
              <circle key={i} cx={px(i)} cy={py(p.y)} r="3.5" fill={c} stroke="#fff" strokeWidth="2"><title>{`${s.name} · ${p.x}: ${fmt(p.y)}`}</title></circle>
            ))}
          </g>
        );
      })}
      {ends.map((e) => <text key={e.s.name} x={W - R + 6} y={e.y! + 3} fontSize="10" fill={INK.primary}>{`${e.s.name.replace(/ (Health Plan|Health Care|Healthcare|Health)$/, "").replace(/Blue Cross (and )?Blue Shield/, "BCBS").replace(/ \(.*\)$/, "").slice(0, 13)} ${fmt(e.v!)}`}</text>)}
    </svg>
  );
}

/** Horizontal bars, one or more values per row (grouped), with an optional reference line (e.g. 100 or 0). */
export function HBars({ rows, keys, fmt, reference, colors }: {
  rows: Array<{ name: string; values: Array<number | null>; note?: string }>;
  keys: string[]; colors: string[]; fmt: (v: number) => string; reference?: { value: number; label: string };
}) {
  const vals = rows.flatMap((r) => r.values).filter((v): v is number => v != null).concat(reference ? [reference.value] : []);
  if (!vals.length) return <p className="text-xs text-stone-500">No data yet.</p>;
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const bh = 9, gap = 2, rowH = keys.length * (bh + gap) + 8;
  const W = 560, L = 140, R = 56, H = rows.length * rowH + 16;
  // Negative values get a gutter for their labels so they never run into the row names.
  const P0 = L + (lo < 0 ? 40 : 0);
  const px = (v: number) => P0 + ((v - lo) / (hi - lo || 1)) * (W - P0 - R);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {reference && <g><line x1={px(reference.value)} x2={px(reference.value)} y1={0} y2={H - 12} stroke={INK.muted} strokeDasharray="3 3" /><text x={px(reference.value)} y={H - 2} textAnchor="middle" fontSize="9" fill={INK.secondary}>{reference.label}</text></g>}
      {rows.map((r, i) => {
        const y = i * rowH + 4;
        return (
          <g key={r.name}>
            <text x={L - 8} y={y + (keys.length * (bh + gap)) / 2 + 3} textAnchor="end" fontSize="11" fill={INK.primary}><title>{r.name}</title>{r.name.replace(/Blue Cross (and |& )?Blue Shield( of)?/, "BCBS").replace(/\((New Hampshire)\)/, "NH").replace(/\(Maine\)/, "ME").replace(/\(Connecticut\)/, "CT").replace(/ Health Plan of Rhode Island/, " RI").replace(/\s+/g, " ").trim().slice(0, 20)}</text>
            {r.values.map((v, k) => {
              if (v == null) return null;
              const x0 = Math.min(px(0), px(v)), w = Math.max(1.5, Math.abs(px(v) - px(0)));
              return (
                <g key={k}>
                  <rect x={x0} y={y + k * (bh + gap)} width={w} height={bh} rx="2" fill={colors[k]}><title>{`${r.name} · ${keys[k]}: ${fmt(v)}${r.note ? ` · ${r.note}` : ""}`}</title></rect>
                  <text x={v >= 0 ? x0 + w + 4 : x0 - 4} y={y + k * (bh + gap) + bh - 1} textAnchor={v >= 0 ? "start" : "end"} fontSize="9.5" fill={INK.secondary}>{fmt(v)}</text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/** One horizontal bar per row, split into parts that sum to 100% (e.g. market share). Parts under 4% go unlabelled. */
export function StackedShares({ rows, color, fmtTotal }: {
  rows: Array<{ label: string; total: number; sub?: string; parts: Array<{ name: string; key?: string; value: number }> }>;
  color: (key?: string) => string; fmtTotal: (v: number) => string;
}) {
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const sum = r.parts.reduce((s, p) => s + p.value, 0) || 1;
        return (
          <div key={r.label}>
            <div className="mb-1 flex items-baseline justify-between text-xs"><span className="font-medium text-stone-800">{r.label}</span><span className="tabular-nums text-stone-500">{fmtTotal(r.total)}{r.sub ? ` · ${r.sub}` : ""}</span></div>
            <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded">
              {r.parts.map((p) => {
                const pct = p.value / sum;
                return (
                  <div key={p.name} title={`${p.name}: ${(pct * 100).toFixed(1)}% · ${fmtTotal(p.value)}`} className={`flex min-w-0 items-center justify-start overflow-hidden px-1 text-[10px] font-medium ${p.key === "__other" ? "text-stone-700" : "text-white"}`} style={{ width: `${pct * 100}%`, background: color(p.key) }}>
                    {pct >= 0.06 ? <span className="truncate" style={p.key === "__other" ? undefined : { textShadow: "0 0 2px rgba(0,0,0,.45)" }}>{p.name.slice(0, 16)} {(pct * 100).toFixed(0)}%</span> : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
