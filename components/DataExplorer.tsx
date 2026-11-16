"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Cell, Col, Level, Pull } from "@/lib/explore";

type Saved = { id: string; name: string; query: string };
type View = { level: Level; states: string[]; from: number; to: number; carriers: string[]; segments: string[]; networks: string[]; metals: string[]; marketed: string[] };
type Props = { pull: Pull; view: View; levels: Array<{ key: Level; label: string; hint: string }>; allStates: string[]; yearRange: [number, number]; marketedOptions: Array<{ key: string; label: string }>; saved: Saved[]; init: { cols?: string; sort?: string; q?: string; chart?: string; by?: string } };

const PALETTE = ["#1c1917", "#c2410c", "#2563eb", "#059669", "#9333ea", "#ca8a04", "#db2777", "#0891b2"];
const num = (v: Cell): v is number => typeof v === "number" && Number.isFinite(v);

function fmt(v: Cell, c: Col): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (!num(v)) return String(v);
  const signed = c.group.startsWith("Change") || c.key === "peers";
  const s = signed && v > 0 ? "+" : "";
  switch (c.type) {
    case "usd": return `${s}${v < 0 ? "−" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;
    case "pct": return `${s}${(v * 100).toFixed(1)}%`;
    case "pts": return `${s}${(v * 100).toFixed(1)} pts`;
    case "x": return `${v.toFixed(2)}×`;
    case "year": return String(v);
    default: return `${s}${Math.round(v).toLocaleString()}`;
  }
}
const axisFmt = (v: number, c: Col) => (c.type === "usd" ? `$${Math.round(v).toLocaleString()}` : c.type === "pct" || c.type === "pts" ? `${(v * 100).toFixed(0)}%` : c.type === "x" ? `${v.toFixed(1)}×` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));

function MultiPick({ label, options, value, onChange }: { label: string; options: Array<{ value: string; label: string }>; value: string[]; onChange: (v: string[]) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false; }; document.addEventListener("click", h); return () => document.removeEventListener("click", h); }, []);
  if (!options.length) return null;
  return (
    <details ref={ref} className="relative">
      <summary className={`flex h-7 cursor-pointer list-none items-center gap-1 rounded border px-2 text-xs ${value.length ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-700"}`}>{label}{value.length ? `: ${value.length === 1 ? options.find((o) => o.value === value[0])?.label ?? value[0] : value.length}` : ""}<span className="opacity-60">▾</span></summary>
      <div className="absolute left-0 z-30 mt-1 max-h-72 w-64 overflow-auto rounded border border-stone-200 bg-white p-2 text-xs shadow-lg">
        {value.length > 0 && <button className="mb-1 text-stone-500 underline" onClick={() => onChange([])}>Clear</button>}
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-stone-50">
            <input type="checkbox" checked={value.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((x) => x !== o.value))} />
            <span className="truncate">{o.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

function Chart({ rows, cols, measure, by }: { rows: Cell[][]; cols: Col[]; measure: Col; by: Col }) {
  const yi = cols.findIndex((c) => c.key === "year"), mi = cols.indexOf(measure), bi = cols.indexOf(by);
  const data = useMemo(() => {
    const g = new Map<string, Map<number, { s: number; n: number }>>(), weight = new Map<string, number>();
    for (const r of rows) {
      const y = r[yi], v = r[mi];
      if (!num(y) || !num(v)) continue;
      const k = String(r[bi] ?? "—");
      const m = g.get(k) ?? g.set(k, new Map()).get(k)!;
      const cell = m.get(y) ?? m.set(y, { s: 0, n: 0 }).get(y)!;
      cell.s += v; cell.n++;
      weight.set(k, (weight.get(k) ?? 0) + 1);
    }
    const keys = [...g.keys()].sort((a, b) => weight.get(b)! - weight.get(a)!);
    const years = [...new Set([...g.values()].flatMap((m) => [...m.keys()]))].sort();
    const series = keys.slice(0, 8).map((k) => ({ k, pts: years.flatMap((y) => { const c = g.get(k)!.get(y); return c ? [{ y, v: measure.agg === "sum" ? c.s : c.s / c.n }] : []; }) }));
    return { years, series, dropped: Math.max(0, keys.length - 8) };
  }, [rows, yi, mi, bi, measure.agg]);
  if (data.years.length < 2 || !data.series.length) return <p className="px-1 py-6 text-xs text-stone-500">A trend needs at least two years in the pull. Widen the year range, or pick a measure that has data in more than one year.</p>;
  const W = 920, H = 300, L = 56, R = 190, T = 14, B = 26;
  const vals = data.series.flatMap((s) => s.pts.map((p) => p.v));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo > 0 && lo / hi < 0.6) lo = 0;
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08; hi += pad; if (lo !== 0) lo -= pad;
  const x = (y: number) => L + ((y - data.years[0]) / (data.years[data.years.length - 1] - data.years[0])) * (W - L - R);
  const yy = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [0, 1, 2, 3, 4].map((i) => lo + ((hi - lo) * i) / 4);
  // End labels, nudged apart so they don't overlap.
  const ends = data.series.map((s, i) => ({ i, k: s.k, v: s.pts[s.pts.length - 1].v, x: x(s.pts[s.pts.length - 1].y), y: yy(s.pts[s.pts.length - 1].v) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  const over = ends.length ? ends[ends.length - 1].y - (H - B - 4) : 0;
  if (over > 0) for (const e of ends) e.y -= over;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[920px]" role="img" aria-label={`${measure.label} by year and ${by.label}`}>
        {ticks.map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={yy(t)} y2={yy(t)} stroke="#e7e5e4" /><text x={L - 6} y={yy(t) + 3} textAnchor="end" fontSize="10" fill="#78716c">{axisFmt(t, measure)}</text></g>)}
        {data.years.map((y) => <text key={y} x={x(y)} y={H - 8} textAnchor="middle" fontSize="10" fill="#78716c">{y}</text>)}
        {data.series.map((s, i) => <g key={s.k}><polyline fill="none" stroke={PALETTE[i]} strokeWidth={i === 0 ? 2.2 : 1.6} points={s.pts.map((p) => `${x(p.y)},${yy(p.v)}`).join(" ")} />{s.pts.map((p) => <circle key={p.y} cx={x(p.y)} cy={yy(p.v)} r="2.5" fill={PALETTE[i]}><title>{`${s.k} · ${p.y}: ${fmt(p.v, measure)}`}</title></circle>)}</g>)}
        {ends.map((e) => <text key={e.k} x={e.x + 8} y={e.y + 3} fontSize="10.5" fill={PALETTE[e.i]}>{e.k.length > 24 ? e.k.slice(0, 23) + "…" : e.k} {fmt(e.v, measure)}</text>)}
      </svg>
      <p className="text-[11px] text-stone-500">{measure.agg === "sum" ? "Total" : "Average"} of {measure.label.toLowerCase()} across the rows shown, by {by.label.toLowerCase()}.{data.dropped ? ` Showing the 8 largest of ${data.dropped + 8}.` : ""}</p>
    </div>
  );
}

export function DataExplorer({ pull, view, levels, allStates, yearRange, marketedOptions, saved, init }: Props) {
  const router = useRouter();
  const path = usePathname();
  const { cols, rows } = pull;
  const defaults = useMemo(() => cols.filter((c) => c.on).map((c) => c.key), [cols]);
  const [shown, setShown] = useState<string[]>(() => { const want = init.cols?.split(",").filter((k) => cols.some((c) => c.key === k)); return want?.length ? want : defaults; });
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(() => { const [k, d] = (init.sort ?? "").split(":"); return cols.some((c) => c.key === k) ? { key: k, dir: d === "asc" ? 1 : -1 } : null; });
  const [q, setQ] = useState(init.q ?? "");
  const numeric = cols.filter((c) => ["int", "usd", "pct", "pts", "x"].includes(c.type));
  const groupable = cols.filter((c) => ["carrier", "segment", "state", "ntype", "metal", "product"].includes(c.key));
  const hasYear = cols.some((c) => c.key === "year");
  const [chart, setChart] = useState<string>(() => (numeric.some((c) => c.key === init.chart) ? init.chart! : ""));
  const [by, setBy] = useState<string>(() => (groupable.some((c) => c.key === init.by) ? init.by! : "carrier"));
  const [limit, setLimit] = useState(200);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState(saved);
  useEffect(() => setBusy(false), [pull]);

  // Server-side state (row level and filters) lives in the URL and reloads the pull.
  const base = (v: View) => {
    const p = new URLSearchParams();
    p.set("level", v.level); p.set("st", v.states.join(",")); p.set("from", String(v.from)); p.set("to", String(v.to));
    const put = (k: string, xs: string[]) => { if (xs.length) p.set(k, xs.join("|")); };
    put("c", v.carriers); put("seg", v.segments); put("net", v.networks); put("metal", v.metals); put("mk", v.marketed);
    return p;
  };
  const go = (patch: Partial<View>) => {
    const next = { ...view, ...patch };
    const p = base(next);
    if (next.level === view.level) { if (shown.join(",") !== defaults.join(",")) p.set("cols", shown.join(",")); if (sort) p.set("sort", `${sort.key}:${sort.dir === 1 ? "asc" : "desc"}`); if (chart) { p.set("chart", chart); p.set("by", by); } if (q) p.set("q", q); }
    setBusy(true);
    router.push(`${path}?${p}`, { scroll: false });
  };
  // Client-side state (columns, sort, search, chart) is mirrored into the URL so a link or a saved pull reproduces the view.
  useEffect(() => {
    const p = base(view);
    if (shown.join(",") !== defaults.join(",")) p.set("cols", shown.join(","));
    if (sort) p.set("sort", `${sort.key}:${sort.dir === 1 ? "asc" : "desc"}`);
    if (q) p.set("q", q);
    if (chart) { p.set("chart", chart); p.set("by", by); }
    window.history.replaceState(null, "", `${path}?${p}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, sort, q, chart, by]);

  const visible = cols.filter((c) => shown.includes(c.key)).sort((a, b) => cols.indexOf(a) - cols.indexOf(b));
  const idx = (k: string) => cols.findIndex((c) => c.key === k);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle ? rows.filter((r) => r.some((v) => typeof v === "string" && v.toLowerCase().includes(needle))) : rows;
    if (sort) { const i = idx(sort.key); out = [...out].sort((a, b) => { const x = a[i], y = b[i]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir; }); }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort]);

  const csv = () => {
    const esc = (v: Cell) => { const s = v == null ? "" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = [visible.map((c) => esc(c.label)).join(","), ...filtered.map((r) => visible.map((c) => esc(r[idx(c.key)])).join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" })); a.download = `payersight-${view.level}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const save = async () => {
    const name = window.prompt("Name this pull");
    if (!name?.trim()) return;
    const r = await fetch("/api/pulls", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim(), query: window.location.search.replace(/^\?/, "") }) });
    if (r.ok) setList([(await r.json()) as Saved, ...list]);
  };
  const remove = async (id: string) => { if ((await fetch(`/api/pulls/${id}`, { method: "DELETE" })).ok) setList(list.filter((s) => s.id !== id)); };
  const [copied, setCopied] = useState(false);
  const groups = [...new Set(cols.map((c) => c.group))];
  const measure = numeric.find((c) => c.key === chart), byCol = groupable.find((c) => c.key === by) ?? groupable[0];
  const chip = (on: boolean) => `rounded px-2 py-1 text-xs ${on ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`;
  const opt = (xs: string[]) => xs.map((v) => ({ value: v, label: v }));
  const years = Array.from({ length: yearRange[1] - yearRange[0] + 1 }, (_, i) => yearRange[0] + i);

  return (
    <div className={`space-y-3 ${busy ? "opacity-60" : ""}`}>
      <div className="card space-y-2.5 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 shrink-0 text-[11px] uppercase tracking-wide text-stone-500">One row per</span>
          {levels.map((l) => <button key={l.key} title={l.hint} className={chip(view.level === l.key)} onClick={() => go({ level: l.key, networks: [], metals: [], segments: [] })}>{l.label.replace(/s$/, "")}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 shrink-0 text-[11px] uppercase tracking-wide text-stone-500">Region</span>
          <button className={chip(view.states.length === allStates.length)} onClick={() => go({ states: allStates })}>All New England</button>
          {allStates.map((s) => <button key={s} className={chip(view.states.length < allStates.length && view.states.includes(s))} onClick={() => { const only = view.states.length === allStates.length ? [s] : view.states.includes(s) ? view.states.filter((x) => x !== s) : [...view.states, s]; go({ states: only.length ? only : allStates }); }}>{s}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 shrink-0 text-[11px] uppercase tracking-wide text-stone-500">Filter</span>
          {hasYear && <label className="flex items-center gap-1 text-xs text-stone-600">Years
            <select className="input h-7 py-0 text-xs" value={view.from} onChange={(e) => go({ from: Number(e.target.value), to: Math.max(view.to, Number(e.target.value)) })}>{years.map((y) => <option key={y}>{y}</option>)}</select>to
            <select className="input h-7 py-0 text-xs" value={view.to} onChange={(e) => go({ to: Number(e.target.value), from: Math.min(view.from, Number(e.target.value)) })}>{years.map((y) => <option key={y}>{y}</option>)}</select></label>}
          <MultiPick label="Carrier" options={opt(pull.options.carriers)} value={view.carriers} onChange={(v) => go({ carriers: v })} />
          <MultiPick label="Segment" options={opt(view.level === "marketed" ? ["Individual", "Small group", "Large group", "Self-funded"] : pull.options.segments)} value={view.segments} onChange={(v) => go({ segments: v })} />
          <MultiPick label={view.level === "marketed" ? "Network model" : "Network type"} options={opt(pull.options.networks)} value={view.networks} onChange={(v) => go({ networks: v })} />
          <MultiPick label="Metal" options={opt(pull.options.metals)} value={view.metals} onChange={(v) => go({ metals: v })} />
          <MultiPick label="Marketed as" options={marketedOptions.map((m) => ({ value: m.key, label: m.label }))} value={view.marketed} onChange={(v) => go({ marketed: v })} />
          {(view.carriers.length || view.segments.length || view.networks.length || view.metals.length || view.marketed.length) ? <button className="text-xs text-stone-500 underline" onClick={() => go({ carriers: [], segments: [], networks: [], metals: [], marketed: [] })}>Clear filters</button> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input className="input h-8 w-56 text-xs" placeholder="Search these rows…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(200); }} />
        <div className="relative">
          <button className="h-8 rounded border border-stone-300 bg-white px-2.5 text-xs" onClick={() => setPicker(!picker)}>Columns ({visible.length} of {cols.length}) ▾</button>
          {picker && (
            <div className="absolute left-0 z-30 mt-1 max-h-[26rem] w-[34rem] overflow-auto rounded border border-stone-200 bg-white p-3 text-xs shadow-lg">
              <div className="mb-2 flex gap-3"><button className="underline" onClick={() => setShown(cols.map((c) => c.key))}>All</button><button className="underline" onClick={() => setShown(defaults)}>Default</button><button className="ml-auto text-stone-500" onClick={() => setPicker(false)}>Close</button></div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {groups.map((g) => { const gc = cols.filter((c) => c.group === g), allOn = gc.every((c) => shown.includes(c.key)); return (
                  <div key={g}>
                    <button className="mb-1 font-medium" onClick={() => setShown(allOn ? shown.filter((k) => !gc.some((c) => c.key === k)) : [...new Set([...shown, ...gc.map((c) => c.key)])])}>{g}</button>
                    {gc.map((c) => <label key={c.key} title={c.hint} className="flex cursor-pointer items-center gap-2 py-0.5"><input type="checkbox" checked={shown.includes(c.key)} onChange={(e) => setShown(e.target.checked ? [...shown, c.key] : shown.filter((k) => k !== c.key))} />{c.label}</label>)}
                  </div>); })}
              </div>
            </div>
          )}
        </div>
        {hasYear && <label className="flex items-center gap-1 text-xs text-stone-600">Trend of
          <select className="input h-8 py-0 text-xs" value={chart} onChange={(e) => setChart(e.target.value)}><option value="">(no chart)</option>{numeric.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
          {chart && <>by<select className="input h-8 py-0 text-xs" value={byCol?.key} onChange={(e) => setBy(e.target.value)}>{groupable.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></>}</label>}
        <div className="ml-auto flex items-center gap-2">
          {list.length > 0 && (
            <details className="relative">
              <summary className="flex h-8 cursor-pointer list-none items-center rounded border border-stone-300 bg-white px-2.5 text-xs">Saved pulls ({list.length}) ▾</summary>
              <div className="absolute right-0 z-30 mt-1 w-72 rounded border border-stone-200 bg-white p-1 text-xs shadow-lg">
                {list.map((s) => <div key={s.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-stone-50"><a className="min-w-0 flex-1 truncate" href={`${path}?${s.query}`}>{s.name}</a><button className="text-stone-400 hover:text-red-700" title="Delete this saved pull" onClick={() => remove(s.id)}>✕</button></div>)}
              </div>
            </details>
          )}
          <button className="h-8 rounded border border-stone-300 bg-white px-2.5 text-xs" onClick={save}>Save pull</button>
          <button className="h-8 rounded border border-stone-300 bg-white px-2.5 text-xs" onClick={() => { void navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy link"}</button>
          <button className="h-8 rounded bg-stone-900 px-2.5 text-xs font-medium text-white" onClick={csv}>Export CSV</button>
        </div>
      </div>

      {measure && byCol && <div className="card p-3"><Chart rows={filtered} cols={cols} measure={measure} by={byCol} /></div>}

      <p className="text-xs text-stone-500">{filtered.length.toLocaleString()} rows{filtered.length !== rows.length ? ` of ${rows.length.toLocaleString()}` : ""}{pull.truncated ? ` (the pull has ${pull.total.toLocaleString()}; the first ${rows.length.toLocaleString()} are loaded: narrow the filters to see the rest)` : ""}. Click a column to sort.</p>
      <div className="card overflow-auto" style={{ maxHeight: "70vh" }}>
        <table data-static className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-white text-left font-mono text-[10px] uppercase text-stone-500 shadow-[0_1px_0_#e7e5e4]">
            <tr>{visible.map((c) => { const n = c.type !== "text" && c.type !== "bool" && c.type !== "year"; return <th key={c.key} title={c.hint} onClick={() => setSort(sort?.key === c.key ? (sort.dir === -1 ? { key: c.key, dir: 1 } : null) : { key: c.key, dir: n ? -1 : 1 })} className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 hover:text-stone-900 ${n ? "text-right" : ""}`}>{c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</th>; })}</tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {filtered.slice(0, limit).map((r, i) => (
              <tr key={i} className="hover:bg-stone-50">
                {visible.map((c) => { const v = r[idx(c.key)], n = c.type !== "text" && c.type !== "bool" && c.type !== "year"; const tone = c.group.startsWith("Change") && num(v) ? (v > 0 ? "text-stone-900" : v < 0 ? "text-red-700" : "") : ""; const long = typeof v === "string" && v.length > 60;
                  return <td key={c.key} title={long ? String(v) : undefined} className={`px-3 py-1.5 ${n ? "whitespace-nowrap text-right tabular-nums" : ""} ${tone} ${v == null || v === "" ? "text-stone-300" : ""} ${long ? "max-w-[22rem] truncate" : ""} ${typeof v === "string" && v.length <= 42 ? "whitespace-nowrap" : ""}`}>{c.key === "source" && typeof v === "string" ? <a className="underline" href={v} target="_blank" rel="noreferrer">{v.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}</a> : fmt(v, c)}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <p className="px-4 py-8 text-center text-sm text-stone-500">Nothing matches these filters.</p>}
      </div>
      {filtered.length > limit && <button className="text-xs underline" onClick={() => setLimit(limit + 500)}>Show 500 more ({(filtered.length - limit).toLocaleString()} not shown; the export and chart include them)</button>}
      {pull.notes.map((n, i) => <p key={i} className="max-w-4xl text-[11px] text-stone-500">{n}</p>)}
    </div>
  );
}
