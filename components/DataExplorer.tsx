"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Agg, Dim, Facts, Fmt, Measure, View } from "@/lib/explore";

/**
 * A pivot table over one dataset's facts: rows (any number of dimensions, nested with subtotals), columns (one
 * dimension), values (any measures, each with its aggregation and "show as"), filters on any dimension, plus a
 * records view, a chart, saved pulls, a shareable link and CSV export. All computed in the browser.
 */
type Saved = { id: string; name: string; query: string };
type Show = "value" | "pctCol" | "pctRow" | "pctParent" | "chg" | "diff";
type Val = { m: string; agg: Agg; show: Show };
type Props = { facts: Facts; datasets: Array<{ key: string; label: string; hint: string }>; saved: Saved[]; init: Record<string, string | undefined> };

const AGG_LABEL: Record<Agg, string> = { sum: "Sum", avg: "Average", wavg: "Weighted avg", min: "Min", max: "Max", median: "Median", count: "Count", distinct: "Count distinct", ratio: "Ratio" };
const SHOW_LABEL: Record<Show, string> = { value: "Value", pctCol: "% of column total", pctRow: "% of row total", pctParent: "% of parent row", chg: "Change vs previous column", diff: "Difference vs previous column" };
const PALETTE = ["#1c1917", "#c2410c", "#2563eb", "#059669", "#9333ea", "#ca8a04", "#db2777", "#0891b2"];
const ALL = -2, BLANK = "(blank)";

function fmtV(v: number | null | undefined, f: Fmt, show: Show = "value"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (show === "pctCol" || show === "pctRow" || show === "pctParent") return `${(v * 100).toFixed(1)}%`;
  if (show === "chg") return f === "pct" ? `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)} pts` : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  const s = show === "diff" && v > 0 ? "+" : "";
  const a = Math.abs(v), neg = v < 0 ? "−" : "";
  switch (f) {
    case "usd": return `${s}${neg}$${a.toLocaleString(undefined, { maximumFractionDigits: a < 100 ? 2 : 0 })}`;
    case "usd0": return `${s}${neg}$${a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(1) + "M" : Math.round(a).toLocaleString()}`;
    case "pct": return show === "diff" ? `${s}${(v * 100).toFixed(1)} pts` : `${(v * 100).toFixed(1)}%`;
    case "x": return `${v.toFixed(2)}×`;
    case "num": return `${s}${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
    default: return `${s}${neg}${Math.round(a).toLocaleString()}`;
  }
}
const axisFmt = (v: number, f: Fmt, show: Show) => (show !== "value" && show !== "diff" ? `${(v * 100).toFixed(0)}%` : f === "pct" ? `${(v * 100).toFixed(0)}%` : f.startsWith("usd") ? `$${Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(0) + "M" : Math.round(v).toLocaleString()}` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));

// ── Aggregation ──────────────────────────────────────────────────────────────────────────────────────────────────
type Acc = { n: number; sum: number; cnt: number; w: number; ws: number; min: number; max: number; vals: number[] | null; set: Set<number> | null; num: number; den: number };
const newAcc = (median: boolean, distinct: boolean): Acc => ({ n: 0, sum: 0, cnt: 0, w: 0, ws: 0, min: Infinity, max: -Infinity, vals: median ? [] : null, set: distinct ? new Set() : null, num: 0, den: 0 });
function finish(a: Acc | undefined, m: Measure, agg: Agg): number | null {
  if (!a) return null;
  switch (agg) {
    case "count": return a.n;
    case "distinct": return a.set!.size;
    case "sum": return a.cnt ? a.sum : null;
    case "avg": return a.cnt ? a.sum / a.cnt : null;
    case "wavg": return a.w > 0 ? a.ws / a.w : a.cnt ? a.sum / a.cnt : null;
    case "min": return a.cnt ? a.min : null;
    case "max": return a.cnt ? a.max : null;
    case "median": { if (!a.vals?.length) return null; const s = [...a.vals].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }
    case "ratio": return a.den ? (a.num / a.den) * (m.mult ?? 1) : null;
  }
}

function parseView(f: Facts, init: Record<string, string | undefined>) {
  const dk = new Set(f.dims.map((d) => d.key)), mk = new Map(f.measures.map((m) => [m.key, m]));
  const toVal = (s: string): Val | null => { const [k, agg, show] = s.split(":"); const m = mk.get(k); if (!m) return null; return { m: k, agg: (m.aggs.includes(agg as Agg) ? agg : m.agg) as Agg, show: (show && show in SHOW_LABEL ? show : "value") as Show }; };
  const src = init.ds === f.key && (init.rows != null || init.vals != null || init.f != null) ? init : null;
  let filters: Record<string, string[]> = f.defaults.filters;
  if (src?.f) { try { filters = JSON.parse(src.f) as Record<string, string[]>; } catch { /* keep defaults */ } }
  filters = Object.fromEntries(Object.entries(filters).filter(([k, v]) => dk.has(k) && Array.isArray(v) && v.length));
  const rows = (src?.rows ?? f.defaults.rows.join(",")).split(",").filter((k) => dk.has(k));
  const col = src ? (src.col && dk.has(src.col) ? src.col : null) : f.defaults.col;
  const vals = (src?.vals ?? f.defaults.vals.join("|")).split("|").map(toVal).filter((v): v is Val => !!v);
  return { rows, col, filters, vals: vals.length ? vals : [toVal(f.defaults.vals[0])!] };
}
const defaultVals = (f: Facts): Val[] => f.defaults.vals.map((s) => { const [m, agg] = s.split(":"); return { m, agg: agg as Agg, show: "value" as Show }; });

// ── Small controls ───────────────────────────────────────────────────────────────────────────────────────────────
function Pop({ label, active, children, align = "left", width = "w-72" }: { label: React.ReactNode; active?: boolean; children: React.ReactNode; align?: "left" | "right"; width?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false; }; document.addEventListener("click", h); return () => document.removeEventListener("click", h); }, []);
  return (
    <details ref={ref} className="relative">
      <summary className={`flex h-7 cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded border px-2 text-xs ${active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-700 hover:border-stone-500"}`}>{label}</summary>
      <div className={`absolute ${align === "right" ? "right-0" : "left-0"} z-40 mt-1 ${width} rounded border border-stone-200 bg-white p-2 text-xs shadow-lg`}>{children}</div>
    </details>
  );
}
function ValuePicker({ dim, counts, value, onChange }: { dim: Dim; counts: number[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const opts = dim.values.map((v, i) => ({ v, n: counts[i] ?? 0 })).filter((o) => !q || o.v.toLowerCase().includes(q.toLowerCase()));
  const shown = opts.slice(0, 300);
  return (
    <div>
      {dim.values.length > 8 && <input className="input mb-1 h-7 w-full text-xs" placeholder={`Search ${dim.values.length.toLocaleString()} values…`} value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="mb-1 flex gap-3 text-stone-500"><button className="underline" onClick={() => onChange([...new Set([...value, ...opts.map((o) => o.v)])])}>Select {q ? "matches" : "all"}</button>{value.length > 0 && <button className="underline" onClick={() => onChange([])}>Clear</button>}</div>
      <div className="max-h-64 overflow-auto">
        {shown.map((o) => (
          <label key={o.v} className={`flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-stone-50 ${o.n ? "" : "text-stone-400"}`}>
            <input type="checkbox" checked={value.includes(o.v)} onChange={(e) => onChange(e.target.checked ? [...value, o.v] : value.filter((x) => x !== o.v))} />
            <span className="min-w-0 flex-1 truncate" title={o.v}>{o.v}</span><span className="tabular-nums text-stone-400">{o.n.toLocaleString()}</span>
          </label>
        ))}
        {opts.length > shown.length && <p className="px-1 py-1 text-stone-400">{(opts.length - shown.length).toLocaleString()} more: search to narrow.</p>}
      </div>
    </div>
  );
}
function DimMenu({ dims, onPick, exclude = [] }: { dims: Dim[]; onPick: (k: string) => void; exclude?: string[] }) {
  const groups = [...new Set(dims.map((d) => d.group))];
  return (
    <div className="max-h-80 overflow-auto">
      {groups.map((g) => (
        <div key={g} className="mb-1.5"><div className="px-1 text-[10px] uppercase tracking-wide text-stone-400">{g}</div>
          {dims.filter((d) => d.group === g && !exclude.includes(d.key)).map((d) => <button key={d.key} title={d.hint} className="block w-full truncate rounded px-1 py-0.5 text-left hover:bg-stone-100" onClick={(e) => { onPick(d.key); (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; }}>{d.label} <span className="text-stone-400">{d.values.length.toLocaleString()}</span></button>)}
        </div>
      ))}
    </div>
  );
}

// ── Charts ───────────────────────────────────────────────────────────────────────────────────────────────────────
function LineChart({ xs, series, fmt, show }: { xs: string[]; series: Array<{ k: string; pts: Array<number | null> }>; fmt: Fmt; show: Show }) {
  const W = 940, H = 300, L = 60, R = 210, T = 14, B = 26;
  const vals = series.flatMap((s) => s.pts.filter((v): v is number => v != null));
  if (!vals.length) return null;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo > 0 && lo / hi < 0.6) lo = 0;
  if (hi === lo) { hi += Math.abs(hi) * 0.1 || 1; lo -= Math.abs(lo) * 0.1 || 1; }
  const pad = (hi - lo) * 0.08; hi += pad; if (lo !== 0) lo -= pad;
  const x = (i: number) => L + (xs.length === 1 ? 0.5 : i / (xs.length - 1)) * (W - L - R), y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ends = series.map((s, i) => { const j = s.pts.map((v, k) => (v == null ? -1 : k)).filter((k) => k >= 0).pop() ?? 0; return { i, k: s.k, v: s.pts[j] ?? null, x: x(j), y: y(s.pts[j] ?? lo) }; }).filter((e) => e.v != null).sort((a, b) => a.y - b.y);
  // Label stacking: push overlapping labels down, then back up from the bottom edge, never above the top.
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  for (let i = ends.length - 1; i >= 0; i--) { const limit = i === ends.length - 1 ? H - B - 2 : ends[i + 1].y - 13; if (ends[i].y > limit) ends[i].y = limit; }
  for (const e of ends) e.y = Math.max(T + 4, e.y);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[940px]" role="img">
      {[0, 1, 2, 3, 4].map((i) => { const t = lo + ((hi - lo) * i) / 4; return <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e7e5e4" /><text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#78716c">{axisFmt(t, fmt, show)}</text></g>; })}
      {xs.map((t, i) => (xs.length <= 14 || i % Math.ceil(xs.length / 14) === 0) && <text key={t} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#78716c">{t}</text>)}
      {series.map((s, i) => { const pts = s.pts.map((v, k) => (v == null ? null : `${x(k)},${y(v)}`)).filter(Boolean); return <g key={s.k}><polyline fill="none" stroke={PALETTE[i % 8]} strokeWidth={i === 0 ? 2.2 : 1.6} points={pts.join(" ")} />{s.pts.map((v, k) => v != null && <circle key={k} cx={x(k)} cy={y(v)} r="2.5" fill={PALETTE[i % 8]}><title>{`${s.k} · ${xs[k]}: ${fmtV(v, fmt, show)}`}</title></circle>)}</g>; })}
      {ends.map((e) => <text key={e.k} x={e.x + 8} y={e.y + 3} fontSize="10.5" fill={PALETTE[e.i % 8]}>{e.k.length > 26 ? e.k.slice(0, 25) + "…" : e.k} {fmtV(e.v, fmt, show)}</text>)}
    </svg>
  );
}
function BarChart({ items, fmt, show }: { items: Array<{ k: string; v: number | null }>; fmt: Fmt; show: Show }) {
  const ok = items.filter((i): i is { k: string; v: number } => i.v != null);
  if (!ok.length) return null;
  const max = Math.max(...ok.map((i) => Math.abs(i.v))) || 1;
  return (
    <div className="max-w-[940px] space-y-1">
      {ok.map((i, n) => <div key={i.k} className="flex items-center gap-2 text-xs"><span className="w-56 shrink-0 truncate text-right text-stone-600" title={i.k}>{i.k}</span><div className="h-4 flex-1"><div className="h-4 rounded-sm" style={{ width: `${(Math.abs(i.v) / max) * 100}%`, background: n === 0 ? "#c2410c" : i.v < 0 ? "#b91c1c" : "#57534e" }} /></div><span className="w-24 shrink-0 tabular-nums">{fmtV(i.v, fmt, show)}</span></div>)}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function DataExplorer({ facts: F, datasets, saved, init }: Props) {
  const router = useRouter(), path = usePathname();
  const v0 = useMemo(() => parseView(F, init), [F, init]);
  const [rows, setRows] = useState<string[]>(v0.rows);
  const [col, setCol] = useState<string | null>(v0.col);
  const [vals, setVals] = useState<Val[]>(v0.vals);
  const [filters, setFilters] = useState<Record<string, string[]>>(v0.filters);
  const own = init.ds === F.key;
  const [mode, setMode] = useState<"pivot" | "records">(own && init.mode === "records" ? "records" : "pivot");
  const [subtotals, setSubtotals] = useState(!(own && init.sub === "0"));
  const [sort, setSort] = useState<{ c: number; dir: 1 | -1 } | null>(() => { if (!own || !init.sort) return null; const [c, d] = init.sort.split(":"); return { c: Number(c), dir: d === "asc" ? 1 : -1 }; });
  const [topN, setTopN] = useState<number>(own ? Number(init.top) || 0 : 0);
  const [chart, setChart] = useState(own && init.chart === "1");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [list, setList] = useState(saved);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recCols, setRecCols] = useState<string[]>(() => [...F.dims.slice(0, 7).map((d) => d.key), ...F.nums.slice(0, 4)]);
  const [recLimit, setRecLimit] = useState(300);

  const dimIdx = useMemo(() => new Map(F.dims.map((d, i) => [d.key, i])), [F]);
  const numIdx = useMemo(() => new Map(F.nums.map((n, i) => [n, F.dims.length + i])), [F]);
  const mById = useMemo(() => new Map(F.measures.map((m) => [m.key, m])), [F]);
  const D = (k: string) => F.dims[dimIdx.get(k)!];
  const numLabel = (k: string) => F.measures.find((m) => m.field === k)?.label ?? k;

  // The URL mirrors the whole view, so a link or a saved pull reproduces it.
  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("ds", F.key);
    if (mode === "records") p.set("mode", "records");
    p.set("rows", rows.join(","));
    if (col) p.set("col", col);
    p.set("vals", vals.map((v) => `${v.m}:${v.agg}:${v.show}`).join("|"));
    if (Object.keys(filters).length) p.set("f", JSON.stringify(filters));
    if (!subtotals) p.set("sub", "0");
    if (sort) p.set("sort", `${sort.c}:${sort.dir === 1 ? "asc" : "desc"}`);
    if (topN) p.set("top", String(topN));
    if (chart) p.set("chart", "1");
    return p.toString();
  }, [F.key, mode, rows, col, vals, filters, subtotals, sort, topN, chart]);
  useEffect(() => { window.history.replaceState(null, "", `${path}?${query}`); }, [path, query]);
  useEffect(() => setBusy(false), [F]);

  const allowSets = (exclude?: string) => Object.entries(filters).filter(([k, vs]) => k !== exclude && vs.length).map(([k, vs]) => { const d = D(k); return { i: dimIdx.get(k)!, allow: new Set(vs.map((v) => (v === BLANK ? -1 : d.values.indexOf(v)))) }; });
  const filtered = useMemo(() => { const sets = allowSets(); return sets.length ? F.rows.filter((r) => sets.every((s) => s.allow.has(r[s.i] ?? -1))) : F.rows; }, [F, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const countsFor = (k: string) => { const i = dimIdx.get(k)!, others = allowSets(k), c = new Array(D(k).values.length).fill(0); for (const r of F.rows) if (r[i] != null && others.every((s) => s.allow.has(r[s.i] ?? -1))) c[r[i]!]++; return c; };

  // ── Pivot ──
  const pivot = useMemo(() => {
    if (mode !== "pivot") return null;
    const ri = rows.map((k) => dimIdx.get(k)!), ci = col ? dimIdx.get(col)! : -1;
    const specs = vals.map((v) => { const m = mById.get(v.m)!; return { v, m, f: m.field ? numIdx.get(m.field) : undefined, w: m.weight ? numIdx.get(m.weight) : undefined, n: m.num ? numIdx.get(m.num) : undefined, d: m.den ? numIdx.get(m.den) : undefined, ds: m.distinct ? dimIdx.get(m.distinct) : undefined }; });
    const cells = new Map<string, Acc[]>();
    const colSeen = new Set<number>();
    for (const r of filtered) {
      const c = ci >= 0 ? (r[ci] ?? -1) : ALL;
      if (ci >= 0) colSeen.add(c);
      let rk = "";
      for (let lvl = 0; lvl <= ri.length; lvl++) {
        if (lvl > 0) rk = lvl === 1 ? String(r[ri[0]] ?? -1) : `${rk},${r[ri[lvl - 1]] ?? -1}`;
        for (const cc of ci >= 0 ? [c, ALL] : [ALL]) {
          const key = `${lvl}|${rk}|${cc}`;
          let accs = cells.get(key);
          if (!accs) { accs = specs.map((s) => newAcc(s.v.agg === "median", s.v.agg === "distinct")); cells.set(key, accs); }
          for (let j = 0; j < specs.length; j++) {
            const s = specs[j], a = accs[j];
            a.n++;
            if (s.ds !== undefined) { const x = r[s.ds]; if (x != null) a.set!.add(x); continue; }
            if (s.n !== undefined) { const nu = r[s.n], de = r[s.d!]; if (nu != null && de != null) { a.num += nu; a.den += de; } continue; }
            if (s.f === undefined) continue;
            const x = r[s.f];
            if (x == null) continue;
            a.cnt++; a.sum += x; if (x < a.min) a.min = x; if (x > a.max) a.max = x; a.vals?.push(x);
            if (s.w !== undefined) { const w = r[s.w]; if (w != null && w > 0) { a.w += w; a.ws += x * w; } }
          }
        }
      }
    }
    const colVals = ci >= 0 ? [...colSeen].sort((a, b) => a - b) : [];
    const cap = 60, colsShown = colVals.slice(0, cap);
    const raw = (lvl: number, rk: string, c: number, j: number) => finish(cells.get(`${lvl}|${rk}|${c}`)?.[j], specs[j].m, specs[j].v.agg);
    const parentKey = (rk: string) => rk.split(",").slice(0, -1).join(",");
    const colPos = (c: number) => colsShown.indexOf(c);
    // The value a cell shows, after "show as".
    const shown = (lvl: number, rk: string, c: number, j: number): number | null => {
      const x = raw(lvl, rk, c, j), sh = specs[j].v.show;
      if (sh === "value" || x == null) return x;
      if (sh === "pctCol") { const t = raw(0, "", c, j); return t ? x / t : null; }
      if (sh === "pctRow") { const t = raw(lvl, rk, ALL, j); return t ? x / t : null; }
      if (sh === "pctParent") { if (lvl === 0) return 1; const t = raw(lvl - 1, parentKey(rk), c, j); return t ? x / t : null; }
      const pos = colPos(c);
      if (c === ALL || pos <= 0) return null;
      const p = raw(lvl, rk, colsShown[pos - 1], j);
      if (p == null) return null;
      if (sh === "diff" || specs[j].m.fmt === "pct") return x - p;
      return p ? x / p - 1 : null;
    };
    const subOf = (s: (typeof specs)[number]) => `${s.m.label}${s.v.agg !== s.m.agg || s.m.aggs.length > 1 ? ` · ${AGG_LABEL[s.v.agg].toLowerCase()}` : ""}${s.v.show !== "value" ? ` (${SHOW_LABEL[s.v.show].toLowerCase()})` : ""}`;
    const cols: Array<{ c: number; j: number; head: string; sub: string }> = [];
    for (const c of colsShown) specs.forEach((s, j) => cols.push({ c, j, head: c === -1 ? BLANK : F.dims[ci].values[c], sub: subOf(s) }));
    specs.forEach((s, j) => { if (ci < 0 || (s.v.show !== "chg" && s.v.show !== "diff")) cols.push({ c: ALL, j, head: ci >= 0 ? "Total" : "", sub: subOf(s) }); });
    // Row tree.
    type Node = { lvl: number; rk: string; label: string; kids: Node[]; hidden: number };
    const levels: Array<Map<string, string[]>> = ri.map(() => new Map());
    for (const key of cells.keys()) {
      const [l, rk, c] = key.split("|"), lvl = Number(l);
      if (lvl === 0 || Number(c) !== ALL) continue;
      const par = parentKey(rk), m = levels[lvl - 1];
      (m.get(par) ?? m.set(par, []).get(par)!).push(rk);
    }
    const sc = sort && cols[sort.c] ? cols[sort.c] : null;
    const build = (lvl: number, rk: string): Node => {
      const last = rk.split(",").pop()!;
      const label = lvl === 0 ? "Total" : last === "-1" ? BLANK : F.dims[ri[lvl - 1]].values[Number(last)];
      let kids = lvl < ri.length ? (levels[lvl].get(rk) ?? []).map((k) => build(lvl + 1, k)) : [];
      if (sc) kids.sort((a, b) => { const x = shown(a.lvl, a.rk, sc.c, sc.j), y = shown(b.lvl, b.rk, sc.c, sc.j); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x - y) * sort!.dir; });
      else if (lvl < ri.length && F.dims[ri[lvl]].numeric) kids.sort((a, b) => Number(b.label) - Number(a.label));
      else kids.sort((a, b) => { const x = raw(a.lvl, a.rk, ALL, 0) ?? -Infinity, y = raw(b.lvl, b.rk, ALL, 0) ?? -Infinity; return y - x || a.label.localeCompare(b.label); });
      let hidden = 0;
      if (topN && kids.length > topN) { hidden = kids.length - topN; kids = kids.slice(0, topN); }
      return { lvl, rk, label, kids, hidden };
    };
    return { tree: build(0, ""), cols, shown, colPos, colVals, capped: colVals.length > cap, specs, ci };
  }, [mode, rows, col, vals, filtered, sort, topN, F, dimIdx, numIdx, mById]);

  // Rows as displayed (respecting collapse and subtotals), also used for export and the chart.
  const flat = useMemo(() => {
    if (!pivot) return [];
    type R = { lvl: number; rk: string; label: string; path: string[]; leaf: boolean; more: boolean; open: boolean };
    const out: R[] = [];
    const walk = (n: typeof pivot.tree, path: string[]) => {
      const p = n.lvl ? [...path, n.label] : path, leaf = n.lvl === rows.length, open = !collapsed.has(n.rk);
      if (n.lvl > 0) out.push({ lvl: n.lvl, rk: n.rk, label: n.label, path: p, leaf, more: false, open });
      if (open || n.lvl === 0) { for (const k of n.kids) walk(k, p); if (n.hidden) out.push({ lvl: n.lvl + 1, rk: `${n.rk}#more`, label: `${n.hidden.toLocaleString()} more not shown (top ${topN})`, path: p, leaf: true, more: true, open: false }); }
    };
    walk(pivot.tree, []);
    return out;
  }, [pivot, collapsed, rows.length, topN]);

  const exportCsv = () => {
    const esc = (s: unknown) => { const t = s == null ? "" : String(s); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    let lines: string[] = [];
    if (mode === "records") {
      lines = [recCols.map((k) => esc(dimIdx.has(k) ? D(k).label : numLabel(k))).join(","), ...filtered.map((r) => recCols.map((k) => { if (dimIdx.has(k)) { const x = r[dimIdx.get(k)!]; return esc(x == null ? "" : D(k).values[x]); } return esc(r[numIdx.get(k)!]); }).join(","))];
    } else if (pivot) {
      const head = [...(rows.length ? rows.map((k) => D(k).label) : ["All rows"]), ...pivot.cols.map((c) => `${c.head ? c.head + " · " : ""}${c.sub}`)];
      const cellv = (lvl: number, rk: string, c: { c: number; j: number }) => { const v = pivot.shown(lvl, rk, c.c, c.j); return v == null ? "" : Number(v.toFixed(6)); };
      const body = flat.filter((r) => !r.more && (r.leaf || subtotals)).map((r) => [...(rows.length ? rows : ["_"]).map((_, i) => (i < r.path.length ? r.path[i] : i === r.path.length ? "Subtotal" : "")), ...pivot.cols.map((c) => cellv(r.lvl, r.rk, c))]);
      const total = [...(rows.length ? rows : ["_"]).map((_, i) => (i === 0 ? "Total" : "")), ...pivot.cols.map((c) => cellv(0, "", c))];
      lines = [head.map(esc).join(","), ...body.map((r) => r.map(esc).join(",")), total.map(esc).join(",")];
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" })); a.download = `payersight-${F.key}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const save = async () => {
    const name = window.prompt("Name this pull");
    if (!name?.trim()) return;
    const r = await fetch("/api/pulls", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim(), query }) });
    if (r.ok) setList([(await r.json()) as Saved, ...list]);
  };
  const remove = async (id: string) => { if ((await fetch(`/api/pulls/${id}`, { method: "DELETE" })).ok) setList(list.filter((s) => s.id !== id)); };
  const swap = () => { const r0 = rows[0] ?? null; setRows(col ? [col, ...rows.slice(1)] : rows.slice(1)); setCol(r0); setSort(null); };
  const reset = () => { setRows(F.defaults.rows); setCol(F.defaults.col); setVals(defaultVals(F)); setFilters(F.defaults.filters); setSort(null); setTopN(0); setCollapsed(new Set()); setMode("pivot"); };

  // Point-in-time counts shouldn't be added up across count dates.
  const snapWarn = useMemo(() => {
    if (!F.snapshot || mode !== "pivot" || rows.includes(F.snapshot) || col === F.snapshot) return false;
    const si = dimIdx.get(F.snapshot)!, by = [...rows, col].filter((k): k is string => !!k).map((k) => dimIdx.get(k)!);
    const seen = new Map<string, number>();
    for (const r of filtered) { const g = by.map((i) => r[i]).join(","), s = r[si] ?? -1, prev = seen.get(g); if (prev === undefined) seen.set(g, s); else if (prev !== s) return true; }
    return false;
  }, [F, mode, rows, col, filtered, dimIdx]);

  const chip = "inline-flex h-7 items-center gap-1 rounded border border-stone-300 bg-white px-2 text-xs";
  const label = (k: string) => D(k)?.label ?? k;
  const lineChart = pivot && pivot.ci >= 0 && F.dims[pivot.ci].numeric && pivot.colVals.length >= 2;
  const chartEl = (() => {
    if (!chart || !pivot || !pivot.specs.length) return null;
    const s0 = pivot.specs[0], leaves = flat.filter((r) => r.leaf && !r.more);
    if (lineChart) {
      const xs = pivot.colVals.map((c) => (c === -1 ? BLANK : F.dims[pivot.ci].values[c]));
      const series = (leaves.length ? leaves : [{ lvl: 0, rk: "", label: "Total", path: ["Total"] }]).slice(0, 8).map((r) => ({ k: r.path.join(" · ") || r.label, pts: pivot.colVals.map((c) => pivot.shown(r.lvl, r.rk, c, 0)) }));
      return <LineChart xs={xs} series={series} fmt={s0.m.fmt} show={s0.v.show} />;
    }
    return <BarChart items={leaves.slice(0, 20).map((r) => ({ k: r.path.join(" · "), v: pivot.shown(r.lvl, r.rk, ALL, 0) }))} fmt={s0.m.fmt} show={s0.v.show === "chg" || s0.v.show === "diff" ? "value" : s0.v.show} />;
  })();

  return (
    <div className={`space-y-3 ${busy ? "pointer-events-none opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] uppercase tracking-wide text-stone-500">Data</span>
        {datasets.map((d) => <button key={d.key} title={d.hint} onClick={() => { if (d.key !== F.key) { setBusy(true); router.push(`${path}?ds=${d.key}`, { scroll: false }); } }} className={`rounded px-2 py-1 text-xs ${d.key === F.key ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}>{d.label}</button>)}
      </div>
      <p className="max-w-5xl text-xs text-stone-500"><span className="font-medium text-stone-700">{F.grain}.</span> {F.rows.length.toLocaleString()} rows. {F.notes[0]}</p>

      <div className="card space-y-2 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-stone-500">View</span>
          {(["pivot", "records"] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={`rounded px-2 py-1 ${mode === m ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>{m === "pivot" ? "Pivot" : "Every record"}</button>)}
          <button className="ml-auto text-stone-500 underline" onClick={reset}>Reset layout</button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-stone-500">Filters</span>
          {Object.entries(filters).map(([k, vs]) => (
            <Pop key={k} active={vs.length > 0} label={<>{label(k)}{vs.length ? `: ${vs.length === 1 ? vs[0].slice(0, 28) : `${vs.length} selected`}` : ": pick values"} ▾</>}>
              <ValuePicker dim={D(k)} counts={countsFor(k)} value={vs} onChange={(nv) => setFilters((f) => ({ ...f, [k]: nv }))} />
              <button className="mt-1 text-stone-500 underline" onClick={() => setFilters((f) => { const n = { ...f }; delete n[k]; return n; })}>Remove filter</button>
            </Pop>
          ))}
          <Pop label="+ Filter"><DimMenu dims={F.dims} exclude={Object.keys(filters)} onPick={(k) => setFilters((f) => ({ ...f, [k]: [] }))} /></Pop>
          {Object.keys(filters).length > 0 && <button className="text-stone-500 underline" onClick={() => setFilters({})}>Clear all</button>}
          <span className="ml-2 text-stone-500">{filtered.length.toLocaleString()} of {F.rows.length.toLocaleString()} rows</span>
        </div>
        {mode === "pivot" && <>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-stone-500">Rows</span>
            {rows.map((k, i) => (
              <span key={k} className={chip}>
                {i > 0 && <button title="Move up a level" className="text-stone-400 hover:text-stone-900" onClick={() => { setRows((r) => { const n = [...r]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; }); setCollapsed(new Set()); }}>←</button>}
                {label(k)}
                <button title="Remove" className="text-stone-400 hover:text-red-700" onClick={() => { setRows((r) => r.filter((x) => x !== k)); setCollapsed(new Set()); }}>✕</button>
              </span>
            ))}
            <Pop label="+ Row"><DimMenu dims={F.dims} exclude={[...rows, col ?? ""]} onPick={(k) => { setRows((r) => [...r, k]); setSort(null); }} /></Pop>
            <button title="Swap the first row field and the column field" className="px-1 text-stone-500 underline" onClick={swap}>⇄ swap</button>
            <span className="ml-3 w-16 shrink-0 text-[11px] uppercase tracking-wide text-stone-500">Columns</span>
            {col ? <span className={chip}>{label(col)}<button className="text-stone-400 hover:text-red-700" onClick={() => { setCol(null); setSort(null); }}>✕</button></span> : <span className="text-stone-400">none</span>}
            <Pop label={col ? "Change" : "+ Column"}><DimMenu dims={F.dims} exclude={[...rows, col ?? ""]} onPick={(k) => { setCol(k); setSort(null); }} /></Pop>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-stone-500">Values</span>
            {vals.map((v, i) => { const m = mById.get(v.m)!; return (
              <span key={i} className={`${chip} gap-1.5`} title={m.hint}>
                <span className="font-medium">{m.label}</span>
                {m.aggs.length > 1 ? <select className="bg-transparent text-stone-600" value={v.agg} onChange={(e) => setVals((vs) => vs.map((x, j) => (j === i ? { ...x, agg: e.target.value as Agg } : x)))}>{m.aggs.map((a) => <option key={a} value={a}>{a === "wavg" && m.weight ? `Avg weighted by ${numLabel(m.weight).toLowerCase()}` : AGG_LABEL[a]}</option>)}</select> : <span className="text-stone-500">{AGG_LABEL[v.agg]}</span>}
                <select className="bg-transparent text-stone-600" value={v.show} onChange={(e) => setVals((vs) => vs.map((x, j) => (j === i ? { ...x, show: e.target.value as Show } : x)))}>{(Object.keys(SHOW_LABEL) as Show[]).filter((s) => (col || (s !== "chg" && s !== "diff" && s !== "pctRow")) && (rows.length > 1 || s !== "pctParent")).map((s) => <option key={s} value={s}>{SHOW_LABEL[s]}</option>)}</select>
                {vals.length > 1 && <button className="text-stone-400 hover:text-red-700" onClick={() => setVals((vs) => vs.filter((_, j) => j !== i))}>✕</button>}
              </span>); })}
            <Pop label="+ Value" width="w-80">
              <div className="max-h-80 overflow-auto">
                {[...new Set(F.measures.map((m) => m.group))].map((g) => <div key={g} className="mb-1.5"><div className="px-1 text-[10px] uppercase tracking-wide text-stone-400">{g}</div>
                  {F.measures.filter((m) => m.group === g).map((m) => <button key={m.key} title={m.hint} className="block w-full truncate rounded px-1 py-0.5 text-left hover:bg-stone-100" onClick={(e) => { setVals((vs) => [...vs, { m: m.key, agg: m.agg, show: "value" }]); (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; }}>{m.label}</button>)}
                </div>)}
              </div>
            </Pop>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-stone-600">
            <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-stone-500">Options</span>
            {rows.length > 1 && <label className="flex items-center gap-1"><input type="checkbox" checked={subtotals} onChange={(e) => setSubtotals(e.target.checked)} />Subtotals</label>}
            <label className="flex items-center gap-1">Show top<select className="input h-6 py-0 text-xs" value={topN} onChange={(e) => setTopN(Number(e.target.value))}>{[0, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n || "all"}</option>)}</select>{rows.length > 1 ? "per group" : "rows"}</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={chart} onChange={(e) => setChart(e.target.checked)} />Chart the first value{lineChart ? " (trend)" : ""}</label>
            {rows.length > 1 && <><button className="underline" onClick={() => setCollapsed(new Set(flat.filter((r) => !r.leaf).map((r) => r.rk)))}>Collapse all</button><button className="underline" onClick={() => setCollapsed(new Set())}>Expand all</button></>}
            <span className="text-stone-400">Click a column header to sort.</span>
          </div>
        </>}
        {mode === "records" && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-stone-500">Columns</span>
            <Pop label={`${recCols.length} of ${F.dims.length + F.nums.length} ▾`} width="w-[30rem]">
              <div className="mb-1 flex gap-3"><button className="underline" onClick={() => setRecCols([...F.dims.map((d) => d.key), ...F.nums])}>All</button></div>
              <div className="grid max-h-80 grid-cols-2 gap-x-4 overflow-auto">
                {[...F.dims.map((d) => ({ k: d.key, l: d.label })), ...F.nums.filter((n) => F.measures.some((m) => m.field === n)).map((n) => ({ k: n, l: numLabel(n) }))].map((c) => <label key={c.k} className="flex items-center gap-2 py-0.5"><input type="checkbox" checked={recCols.includes(c.k)} onChange={(e) => setRecCols((x) => (e.target.checked ? [...x, c.k] : x.filter((y) => y !== c.k)))} />{c.l}</label>)}
              </div>
            </Pop>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {snapWarn && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">These are point-in-time counts, and several count dates are being added together. Put “{label(F.snapshot!)}” on rows or columns, or filter to one quarter.</p>}
        {pivot?.capped && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">Showing the first 60 of {pivot.colVals.length.toLocaleString()} column values. Filter, or move this field to rows.</p>}
        <div className="ml-auto flex items-center gap-2">
          {list.length > 0 && (
            <Pop align="right" label={`Saved pulls (${list.length}) ▾`}>
              {list.map((s) => <div key={s.id} className="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-stone-50"><a className="min-w-0 flex-1 truncate" href={`${path}?${s.query}`}>{s.name}</a><button className="text-stone-400 hover:text-red-700" title="Delete" onClick={() => remove(s.id)}>✕</button></div>)}
            </Pop>
          )}
          <button className="h-7 rounded border border-stone-300 bg-white px-2.5 text-xs" onClick={save}>Save pull</button>
          <button className="h-7 rounded border border-stone-300 bg-white px-2.5 text-xs" onClick={() => { void navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy link"}</button>
          <button className="h-7 rounded bg-stone-900 px-2.5 text-xs font-medium text-white" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      {chartEl && <div className="card p-3">{chartEl}<p className="mt-1 text-[11px] text-stone-500">{pivot!.specs[0].m.label} ({AGG_LABEL[pivot!.specs[0].v.agg].toLowerCase()}{pivot!.specs[0].v.show !== "value" ? `, ${SHOW_LABEL[pivot!.specs[0].v.show].toLowerCase()}` : ""}) for the first {lineChart ? 8 : 20} rows in the table&apos;s order.</p></div>}

      {pivot && (
        <div className="card overflow-auto" style={{ maxHeight: "72vh" }}>
          <table data-static className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-white text-left shadow-[0_1px_0_#e7e5e4]">
              {pivot.ci >= 0 && (
                <tr className="text-[11px] text-stone-700">
                  <th className="sticky left-0 z-20 bg-white px-3 pt-2 font-normal text-stone-500">{label(col!)} →</th>
                  {(() => { const g: Array<{ head: string; span: number; total: boolean }> = []; for (const c of pivot.cols) { const last = g[g.length - 1]; if (last && last.head === c.head && last.total === (c.c === ALL)) last.span++; else g.push({ head: c.head, span: 1, total: c.c === ALL }); } return g.map((x, i) => <th key={i} colSpan={x.span} className={`whitespace-nowrap border-l border-stone-100 px-3 pt-2 text-right font-semibold ${x.total ? "bg-stone-50" : ""}`}>{x.head}</th>); })()}
                </tr>
              )}
              <tr className="text-[10px] text-stone-500">
                <th className="sticky left-0 z-20 bg-white px-3 py-2 font-mono uppercase">{rows.length ? rows.map(label).join(" › ") : "All rows"}</th>
                {pivot.cols.map((c, i) => <th key={i} title="Click to sort" onClick={() => setSort(sort?.c === i ? (sort.dir === -1 ? { c: i, dir: 1 } : null) : { c: i, dir: -1 })} className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-right font-medium hover:text-stone-900 ${c.c === ALL && pivot.ci >= 0 ? "bg-stone-50" : ""} ${pivot.ci >= 0 && c.j === 0 ? "border-l border-stone-100" : ""}`}>{c.sub}{sort?.c === i ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {flat.map((r) => r.more ? (
                <tr key={r.rk}><td colSpan={pivot.cols.length + 1} className="px-3 py-1 text-stone-400" style={{ paddingLeft: 12 + (r.lvl - 1) * 18 }}>{r.label}</td></tr>
              ) : (
                <tr key={r.rk} className={r.leaf ? "bg-white hover:bg-stone-50" : "bg-stone-50 font-medium"}>
                  <td className="sticky left-0 z-[1] max-w-[24rem] truncate bg-inherit px-3 py-1.5" style={{ paddingLeft: 12 + (r.lvl - 1) * 18 }} title={r.path.join(" › ")}>
                    {!r.leaf && <button className="mr-1 w-3 text-stone-400" onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(r.rk)) n.delete(r.rk); else n.add(r.rk); return n; })}>{r.open ? "▾" : "▸"}</button>}{r.label}
                  </td>
                  {pivot.cols.map((c, i) => { const showIt = r.leaf || subtotals || !r.open; const v = showIt ? pivot.shown(r.lvl, r.rk, c.c, c.j) : null; const sh = pivot.specs[c.j].v.show; return <td key={i} className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${c.c === ALL && pivot.ci >= 0 ? "bg-stone-50 font-medium" : ""} ${pivot.ci >= 0 && c.j === 0 ? "border-l border-stone-100" : ""} ${v == null ? "text-stone-300" : (sh === "chg" || sh === "diff") && v < 0 ? "text-red-700" : ""}`}>{showIt ? fmtV(v, pivot.specs[c.j].m.fmt, sh) : ""}</td>; })}
                </tr>
              ))}
              <tr className="sticky bottom-0 bg-stone-100 font-semibold">
                <td className="sticky left-0 bg-stone-100 px-3 py-1.5">Total</td>
                {pivot.cols.map((c, i) => <td key={i} className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{fmtV(pivot.shown(0, "", c.c, c.j), pivot.specs[c.j].m.fmt, pivot.specs[c.j].v.show)}</td>)}
              </tr>
            </tbody>
          </table>
          {!filtered.length && <p className="px-4 py-8 text-center text-sm text-stone-500">No rows match these filters.</p>}
        </div>
      )}

      {mode === "records" && (
        <div className="card overflow-auto" style={{ maxHeight: "72vh" }}>
          <table data-static className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-white text-left font-mono text-[10px] uppercase text-stone-500 shadow-[0_1px_0_#e7e5e4]"><tr>{recCols.map((k) => <th key={k} className={`whitespace-nowrap px-3 py-2 ${numIdx.has(k) ? "text-right" : ""}`}>{dimIdx.has(k) ? label(k) : numLabel(k)}</th>)}</tr></thead>
            <tbody className="divide-y divide-stone-100">{filtered.slice(0, recLimit).map((r, i) => <tr key={i} className="hover:bg-stone-50">{recCols.map((k) => { if (dimIdx.has(k)) { const x = r[dimIdx.get(k)!]; return <td key={k} className="max-w-[20rem] truncate px-3 py-1.5" title={x == null ? "" : D(k).values[x]}>{x == null ? <span className="text-stone-300">—</span> : D(k).values[x]}</td>; } const m = F.measures.find((mm) => mm.field === k); return <td key={k} className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{fmtV(r[numIdx.get(k)!], m?.fmt ?? "num")}</td>; })}</tr>)}</tbody>
          </table>
          {filtered.length > recLimit && <button className="m-3 text-xs underline" onClick={() => setRecLimit(recLimit + 1000)}>Show 1,000 more ({(filtered.length - recLimit).toLocaleString()} not shown; the export includes them)</button>}
        </div>
      )}
      {F.notes.slice(1).map((n, i) => <p key={i} className="max-w-4xl text-[11px] text-stone-500">{n}</p>)}
    </div>
  );
}
