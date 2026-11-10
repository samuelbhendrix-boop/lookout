"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

export type MapState = { abbr: string; d: string; box: [number, number, number, number] };
export type MapHospital = { key: string; name: string; city: string; state: string; type: string; stars: number | null; system: string | null; x: number; y: number; matched: boolean; approx?: boolean; carriers: Record<string, 1 | 2> };
export type MapCarrier = { id: string; name: string; short: string; logo?: string | null };

type Mode = "count" | "carrier" | "compare" | "system";
const C = { in: "#047857", out: "#d6d3d1", outpatient: "#d97706", a: "#047857", b: "#0369a1", both: "#1c1917", none: "#e7e5e4" };
const SYS_COLORS = ["#7c3aed", "#0369a1", "#047857", "#b45309", "#be123c", "#0f766e", "#4338ca", "#a16207", "#9d174d", "#15803d", "#1d4ed8", "#c2410c", "#0891b2", "#65a30d", "#db2777", "#475569", "#ea580c", "#6d28d9", "#059669", "#e11d48"];

/**
 * Hospital network map: zoom (wheel, buttons, click a state), pan (drag), hover for a summary, click a hospital for
 * which carriers price it. Colour by number of carriers, one carrier's network, two carriers head to head, or health system.
 */
export function NetworkMapInteractive({ width, height, states, focus, hospitals, carriers, initial }: {
  width: number; height: number; states: MapState[]; focus: string; hospitals: MapHospital[]; carriers: MapCarrier[];
  initial: { carrier?: string; a?: string; b?: string };
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initial.a && initial.b ? "compare" : initial.carrier ? "carrier" : "count");
  const [carrier, setCarrier] = useState(initial.carrier ?? carriers[0]?.id ?? "");
  const [a, setA] = useState(initial.a ?? carriers[0]?.id ?? "");
  const [b, setB] = useState(initial.b ?? carriers[1]?.id ?? "");
  const [sel, setSel] = useState<MapHospital | null>(null);
  const [hover, setHover] = useState<{ h: MapHospital; x: number; y: number } | null>(null);
  const [q, setQ] = useState("");
  const [sysFilter, setSysFilter] = useState<string>("");
  const home = useMemo(() => fit(states.find((s) => s.abbr === focus)?.box ?? union(states.map((s) => s.box)), width, height), [focus, states, width, height]);
  const [view, setView] = useState(home);
  useEffect(() => setView(home), [home]);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  const max = Math.max(1, ...hospitals.map((h) => Object.keys(h.carriers).length));
  const systems = useMemo(() => [...new Set(hospitals.map((h) => h.system).filter(Boolean) as string[])].sort(), [hospitals]);
  const sysColor = (s: string | null) => (s ? SYS_COLORS[systems.indexOf(s) % SYS_COLORS.length] : "#a8a29e");
  const nameOf = (id: string) => carriers.find((c) => c.id === id)?.short ?? id;

  const style = (h: MapHospital): { fill: string; r: number; opacity: number; dashed?: boolean } => {
    if (!h.matched && mode !== "system") return { fill: "#ffffff", r: 4.5, opacity: 1, dashed: true };
    if (mode === "count") { const n = Object.keys(h.carriers).length; return { fill: "#1c1917", r: 3 + 7 * (n / max), opacity: 0.55 }; }
    if (mode === "carrier") { const p = h.carriers[carrier]; return { fill: p === 2 ? C.in : p === 1 ? C.outpatient : C.out, r: 5, opacity: 0.92 }; }
    if (mode === "compare") { const pa = !!h.carriers[a], pb = !!h.carriers[b]; return { fill: pa && pb ? C.both : pa ? C.a : pb ? C.b : C.none, r: pa !== pb ? 6 : 4.5, opacity: 0.9 }; }
    return { fill: sysColor(h.system), r: h.system ? 5.5 : 3.5, opacity: h.system ? 0.9 : 0.5 };
  };

  // Zoom around a point (svg coordinates).
  const zoomAt = (factor: number, cx: number, cy: number) => setView((v) => {
    const k = Math.min(40, Math.max(home.k * 0.8, v.k * factor));
    return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
  });
  const toSvg = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * width, ((e.clientY - r.top) / r.height) * height] as const;
  };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const [x, y] = toSvg(e); zoomAt(e.deltaY < 0 ? 1.25 : 0.8, x, y); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const visible = hospitals.filter((h) => !sysFilter || h.system === sysFilter);
  const matches = q.length >= 2 ? hospitals.filter((h) => `${h.name} ${h.city}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  const pick = (h: MapHospital) => { setSel(h); setQ(""); setView({ k: Math.max(view.k, home.k * 3), x: width / 2 - h.x * Math.max(view.k, home.k * 3), y: height / 2 - h.y * Math.max(view.k, home.k * 3) }); };
  const chip = (on: boolean) => `rounded px-2 py-1 ${on ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`;

  const counts = mode === "compare" ? (() => { const g = visible.filter((h) => h.matched); return { onlyA: g.filter((h) => h.carriers[a] && !h.carriers[b]).length, onlyB: g.filter((h) => h.carriers[b] && !h.carriers[a]).length, both: g.filter((h) => h.carriers[a] && h.carriers[b]).length }; })() : null;

  return (
    <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="relative min-w-0">
        <div className="flex flex-wrap items-center gap-1 border-b border-stone-100 px-3 py-2 text-xs">
          <span className="mr-1 text-stone-500">Colour by</span>
          <button className={chip(mode === "count")} onClick={() => setMode("count")}>Carriers pricing</button>
          <button className={chip(mode === "carrier")} onClick={() => setMode("carrier")}>One carrier</button>
          <button className={chip(mode === "compare")} onClick={() => setMode("compare")}>Head to head</button>
          <button className={chip(mode === "system")} onClick={() => setMode("system")}>Health system</button>
          {mode === "carrier" && <select value={carrier} onChange={(e) => setCarrier(e.target.value)} className="input ml-2 h-7 max-w-[220px] py-0 text-xs">{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
          {mode === "compare" && <>
            <select value={a} onChange={(e) => setA(e.target.value)} className="input ml-2 h-7 max-w-[180px] py-0 text-xs" style={{ color: C.a }}>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <span className="text-stone-400">vs</span>
            <select value={b} onChange={(e) => setB(e.target.value)} className="input h-7 max-w-[180px] py-0 text-xs" style={{ color: C.b }}>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </>}
          {mode === "system" && <select value={sysFilter} onChange={(e) => setSysFilter(e.target.value)} className="input ml-2 h-7 max-w-[220px] py-0 text-xs"><option value="">All systems</option>{systems.map((s) => <option key={s} value={s}>{s}</option>)}</select>}
        </div>
        <div className="relative">
          <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="h-auto w-full touch-none select-none" style={{ cursor: drag.current ? "grabbing" : "grab" }}
            onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); const [x, y] = toSvg(e); drag.current = { x, y, vx: view.x, vy: view.y, moved: false }; }}
            onPointerMove={(e) => { if (!drag.current) return; const [x, y] = toSvg(e); const dx = x - drag.current.x, dy = y - drag.current.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true; if (drag.current.moved) setView((v) => ({ ...v, x: drag.current!.vx + dx, y: drag.current!.vy + dy })); }}
            onPointerUp={() => { setTimeout(() => { drag.current = null; }, 0); }}
            onPointerLeave={() => { drag.current = null; setHover(null); }}>
            <rect width={width} height={height} fill="#fafaf9" />
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {states.map((s) => (
                <path key={s.abbr} d={s.d} fill={s.abbr === focus || focus === "all" ? "#ffffff" : "#f5f5f4"} stroke="#d6d3d1" strokeWidth={1} vectorEffect="non-scaling-stroke"
                  className="cursor-pointer hover:fill-stone-50" onClick={() => { if (drag.current?.moved) return; if (s.abbr !== focus) router.push(`/networks?state=${s.abbr}`); else setView(fit(s.box, width, height)); }}>
                  <title>{s.abbr === focus ? `Zoom to ${s.abbr}` : `Show ${s.abbr}'s networks`}</title>
                </path>
              ))}
              {visible.map((h) => {
                const st = style(h);
                const on = sel?.key === h.key;
                return (
                  <circle key={h.key} cx={h.x} cy={h.y} r={(on ? st.r + 2 : st.r) / view.k * Math.min(1.6, Math.sqrt(view.k / home.k))} fill={st.fill} fillOpacity={st.opacity}
                    stroke={on ? "#1c1917" : st.dashed ? "#78716c" : "#ffffff"} strokeWidth={(on ? 2 : 1) / view.k} strokeDasharray={st.dashed ? `${2 / view.k} ${2 / view.k}` : undefined}
                    className="cursor-pointer"
                    onPointerEnter={(e) => { const r = svgRef.current!.getBoundingClientRect(); setHover({ h, x: e.clientX - r.left, y: e.clientY - r.top }); }}
                    onPointerLeave={() => setHover(null)}
                    onClick={(e) => { e.stopPropagation(); if (!drag.current?.moved) setSel(h); }} />
                );
              })}
            </g>
          </svg>
          <div className="absolute right-2 top-2 flex flex-col gap-1">
            <button className="h-7 w-7 rounded bg-white text-sm shadow ring-1 ring-stone-200 hover:bg-stone-50" onClick={() => zoomAt(1.5, width / 2, height / 2)} aria-label="Zoom in">+</button>
            <button className="h-7 w-7 rounded bg-white text-sm shadow ring-1 ring-stone-200 hover:bg-stone-50" onClick={() => zoomAt(1 / 1.5, width / 2, height / 2)} aria-label="Zoom out">−</button>
            <button className="h-7 w-7 rounded bg-white text-[10px] shadow ring-1 ring-stone-200 hover:bg-stone-50" onClick={() => setView(home)} aria-label="Reset view">⟲</button>
          </div>
          {hover && (
            <div className="pointer-events-none absolute z-10 max-w-[260px] rounded bg-stone-900 px-2.5 py-1.5 text-[11px] text-white shadow-lg" style={{ left: Math.min(hover.x + 12, 9999), top: hover.y + 12 }}>
              <div className="font-medium">{title(hover.h.name)}</div>
              <div className="text-stone-300">{title(hover.h.city)}, {hover.h.state}{hover.h.system ? ` · ${hover.h.system}` : ""}{hover.h.stars ? ` · ${hover.h.stars}★` : ""}</div>
              <div className="mt-0.5">{!hover.h.matched ? "Network status unknown (no rate-file match)" : mode === "carrier" ? (hover.h.carriers[carrier] ? `In ${nameOf(carrier)}${hover.h.carriers[carrier] === 1 ? " (outpatient only)" : ""}` : `Not priced by ${nameOf(carrier)}`) : mode === "compare" ? [hover.h.carriers[a] ? nameOf(a) : null, hover.h.carriers[b] ? nameOf(b) : null].filter(Boolean).join(" + ") || "Neither" : `Priced by ${Object.keys(hover.h.carriers).length} carrier${Object.keys(hover.h.carriers).length === 1 ? "" : "s"}`}</div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-stone-100 px-3 py-2 text-[11px] text-stone-500">
          {mode === "count" && <span>Dot size = carriers pricing the hospital.</span>}
          {mode === "carrier" && <><Dot c={C.in} t="In network (inpatient priced)" /><Dot c={C.outpatient} t="Outpatient only" /><Dot c={C.out} t="Not priced" /></>}
          {mode === "compare" && counts && <><Dot c={C.a} t={`Only ${nameOf(a)} (${counts.onlyA})`} /><Dot c={C.b} t={`Only ${nameOf(b)} (${counts.onlyB})`} /><Dot c={C.both} t={`Both (${counts.both})`} /><Dot c={C.none} t="Neither" /></>}
          {mode === "system" && <span>Colour = health system; small grey dots are independent hospitals.</span>}
          {mode !== "system" && <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border border-dashed border-stone-500 align-middle" />Unknown (no TIN match)</span>}
          <span className="ml-auto">Scroll or +/− to zoom · drag to pan · click a state to zoom or switch</span>
        </div>
      </div>
      <aside className="border-t border-stone-100 p-3 text-sm lg:border-l lg:border-t-0">
        <div className="relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a hospital…" className="input h-8 w-full text-xs" />
          {matches.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full rounded border border-stone-200 bg-white text-xs shadow">
              {matches.map((h) => <li key={h.key}><button className="block w-full px-2 py-1 text-left hover:bg-stone-50" onClick={() => pick(h)}>{title(h.name)} <span className="text-stone-400">{title(h.city)}</span></button></li>)}
            </ul>
          )}
        </div>
        {sel ? (
          <div className="mt-3 space-y-2">
            <div>
              <div className="font-medium">{title(sel.name)}</div>
              <div className="text-xs text-stone-500">{title(sel.city)}, {sel.state} · {sel.type.replace(" Hospitals", "")}{sel.stars ? ` · ${sel.stars}★ CMS` : ""}</div>
              {sel.system && <button className="mt-1 rounded bg-stone-100 px-1.5 py-0.5 text-[11px] hover:bg-stone-200" onClick={() => { setMode("system"); setSysFilter(sel.system!); }}>{sel.system}</button>}
            </div>
            {!sel.matched ? <p className="text-xs text-stone-500">No carrier rate file could be tied to this hospital&apos;s tax ID, so its network status is unknown.</p> : (
              <ul className="space-y-0.5 text-xs">
                {[...carriers].sort((x, y) => (sel.carriers[y.id] ?? 0) - (sel.carriers[x.id] ?? 0)).map((c) => {
                  const p = sel.carriers[c.id];
                  return (
                    <li key={c.id} className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p === 2 ? C.in : p === 1 ? C.outpatient : "transparent", border: p ? "none" : "1px solid #d6d3d1" }} />
                      {c.logo ? <img src={c.logo} alt="" className="h-4 w-4 shrink-0 rounded-sm object-contain" /> : null}
                      <button className={`truncate text-left hover:underline ${p ? "text-stone-800" : "text-stone-400"}`} onClick={() => { setMode("carrier"); setCarrier(c.id); }}>{c.name}</button>
                      <span className="ml-auto text-[10px] text-stone-400">{p === 2 ? "in" : p === 1 ? "outpt" : "—"}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <button className="text-[11px] text-stone-500 hover:underline" onClick={() => setSel(null)}>Clear</button>
          </div>
        ) : <p className="mt-3 text-xs text-stone-500">Click a hospital to see which carriers price it. Click a carrier name to colour the map by its network.</p>}
        {mode === "system" && (
          <ul className="mt-3 max-h-[420px] space-y-0.5 overflow-auto border-t border-stone-100 pt-2 text-[11px]">
            {systems.map((s) => <li key={s}><button className={`flex w-full items-center gap-1.5 text-left hover:underline ${sysFilter === s ? "font-medium" : ""}`} onClick={() => setSysFilter(sysFilter === s ? "" : s)}><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: sysColor(s) }} />{s} <span className="text-stone-400">({hospitals.filter((h) => h.system === s).length})</span></button></li>)}
          </ul>
        )}
      </aside>
    </div>
  );
}

function Dot({ c, t }: { c: string; t: string }) { return <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: c }} />{t}</span>; }
const title = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Ii|Iii|Nh|Ma|Ct|Ri|Vt|Me|Umass|Ucv)\b/g, (m) => m.toUpperCase()).replace(/'S\b/g, "'s");
const union = (bs: Array<[number, number, number, number]>): [number, number, number, number] => [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
function fit(b: [number, number, number, number], w: number, h: number) {
  const pad = 16;
  const k = Math.min((w - 2 * pad) / Math.max(1, b[2] - b[0]), (h - 2 * pad) / Math.max(1, b[3] - b[1]));
  return { k, x: w / 2 - ((b[0] + b[2]) / 2) * k, y: h / 2 - ((b[1] + b[3]) / 2) * k };
}
