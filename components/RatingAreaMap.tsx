import geo from "@/data/geo/rating-areas.json";
import { CATEGORICAL } from "@/components/viz";

type StateGeo = {
  width: number; height: number; by: "county" | "zip3" | "state"; outline: string; counties: string;
  countyNames: Array<{ name: string; at: number[] }>;
  areas: Array<{ id: string; members: string[]; d: string; at: number[] }>;
  cities: Array<{ name: string; at: number[] }>;
};
const STATES = (geo as unknown as { states: Record<string, StateGeo> }).states;
export const hasRatingAreaMap = (state: string) => !!STATES[state];
export const ratingAreasOf = (state: string) => STATES[state]?.areas.map((a) => ({ id: a.id, members: a.members })) ?? [];

const num = (id: string) => id.replace(/\D/g, "");
/** "010, 011, 012, 013" → "010–013"; counties joined. */
function members(by: StateGeo["by"], m: string[]) {
  if (by !== "zip3") return m.join(", ");
  const n = m.map(Number).sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < n.length; i++) {
    let j = i;
    while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++;
    const f = (x: number) => String(x).padStart(3, "0");
    runs.push(i === j ? f(n[i]) : `${f(n[i])}–${f(n[j])}`);
    i = j;
  }
  return `ZIP ${runs.join(", ")}xx`;
}

// Sequential (light → the categorical blue) and diverging (green = below, red = above) ramps.
const mix = (a: string, b: string, t: number) => {
  const p = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, "0")).join("")}`;
};
const SEQ = (t: number) => mix("#e6eef9", "#1f5fae", t);
const DIV = (t: number) => (t < 0 ? mix("#f5f5f4", "#0f8a5f", -t) : mix("#f5f5f4", "#c9362f", t));

/**
 * A state's ACA rating areas (CMS definitions), drawn from pre-projected shapes. With `values`, areas are shaded by
 * value (sequential, or diverging around zero); without, each area gets its own tint. `mark` outlines areas (e.g. ones a
 * carrier holds the benchmark in).
 */
export function RatingAreaMap({ state, values, fmt = (v) => String(v), scale = "seq", valueLabel, mark, markLabel, caption, compact = false }: {
  state: string; values?: Record<string, number | null | undefined>; fmt?: (v: number) => string; scale?: "seq" | "div";
  valueLabel?: string; mark?: string[]; markLabel?: string; caption?: React.ReactNode; compact?: boolean;
}) {
  const g = STATES[state];
  if (!g) return null;
  const vals = g.areas.map((a) => values?.[a.id]).filter((v): v is number => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals), amax = Math.max(...vals.map(Math.abs));
  const fill = (id: string, i: number) => {
    if (!values) return mix("#ffffff", CATEGORICAL[i % CATEGORICAL.length], 0.38);
    const v = values[id];
    if (v == null) return "#e7e5e4";
    return scale === "div" ? DIV(amax ? v / amax : 0) : SEQ(hi > lo ? 0.15 + ((v - lo) / (hi - lo)) * 0.85 : 0.5);
  };
  const dark = (id: string) => values && values[id] != null && (scale === "seq" ? hi > lo && (values[id]! - lo) / (hi - lo) > 0.6 : Math.abs(values[id]!) / (amax || 1) > 0.6);
  const single = g.areas.length === 1;
  const maxH = compact ? 340 : 420;
  // Shapes are drawn in their own units; scale marks and text so they render at a constant pixel size.
  const u = Math.max(1, g.height / maxH);

  return (
    <figure className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <svg viewBox={`0 0 ${g.width} ${g.height}`} className="w-full shrink-0 overflow-visible sm:w-auto" style={{ maxHeight: maxH, maxWidth: (maxH * g.width) / g.height }} role="img" aria-label={`${state} rating areas`}>
        <path d={g.outline} fill="#e7e5e4" stroke="none" />
        {g.areas.map((a, i) => (
          <path key={a.id} d={a.d} fill={fill(a.id, i)} stroke="#fff" strokeWidth={1.5 * u} strokeLinejoin="round">
            <title>{`${a.id}: ${members(g.by, a.members)}${values?.[a.id] != null ? ` · ${valueLabel ?? ""} ${fmt(values[a.id]!)}` : ""}`}</title>
          </path>
        ))}
        {g.by !== "county" && g.counties && <path d={g.counties} fill="none" stroke="#a8a29e" strokeWidth={0.6} strokeDasharray="2 2" opacity={0.7} pointerEvents="none" />}
        {mark?.length ? g.areas.filter((a) => mark.includes(a.id)).map((a) => <path key={`m${a.id}`} d={a.d} fill="none" stroke="#1c1917" strokeWidth={2.5 * u} pointerEvents="none" />) : null}
        <path d={g.outline} fill="none" stroke="#78716c" strokeWidth={1} pointerEvents="none" />
        {!single && g.areas.map((a) => (
          <g key={`l${a.id}`} pointerEvents="none">
            <circle cx={a.at[0]} cy={a.at[1]} r={10 * u} fill="#fff" stroke={dark(a.id) ? "#1c1917" : "#78716c"} strokeWidth={1} />
            <text x={a.at[0]} y={a.at[1] + 4 * u} textAnchor="middle" fontSize={11.5 * u} fontWeight={600} fill="#1c1917">{num(a.id)}</text>
          </g>
        ))}
        {g.cities.map((c) => (
          <g key={c.name} pointerEvents="none">
            <circle cx={c.at[0]} cy={c.at[1]} r={2.6 * u} fill="#1c1917" />
            <text x={c.at[0] + 5 * u} y={c.at[1] + 3.5 * u} fontSize={11 * u} fill="#1c1917" stroke="#fff" strokeWidth={3 * u} paintOrder="stroke">{c.name}</text>
          </g>
        ))}
      </svg>
      <figcaption className="min-w-0 flex-1 text-xs text-stone-600">
        {caption && <div className="mb-2 text-stone-500">{caption}</div>}
        {single ? (
          <p>{state} is one rating area statewide: every carrier prices the same in every county{state === "VT" ? ", and Vermont is also community-rated (one price at every age)" : ""}.</p>
        ) : (
          <table className="w-full" data-static>
            <thead className="text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
              <tr><th className="py-1 pr-2">Area</th><th className="py-1 pr-2">{g.by === "zip3" ? "3-digit ZIP" : "Counties"}</th>{values && <th className="py-1 text-right">{valueLabel ?? "Value"}</th>}</tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {g.areas.map((a, i) => (
                <tr key={a.id} className={mark?.includes(a.id) ? "font-medium text-stone-900" : ""}>
                  <td className="whitespace-nowrap py-1 pr-2"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: fill(a.id, i) }} />{num(a.id)}</td>
                  <td className="py-1 pr-2">{members(g.by, a.members).replace(/^ZIP /, "")}</td>
                  {values && <td className="py-1 text-right tabular-nums">{values[a.id] != null ? fmt(values[a.id]!) : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {mark?.length && markLabel ? <p className="mt-1.5"><span className="mr-1 inline-block h-2.5 w-3.5 border-2 border-stone-900 align-middle" />{markLabel}</p> : null}
        <p className="mt-1.5 text-[10px] text-stone-400">CMS rating areas{g.by === "zip3" ? "; Massachusetts defines them by the first 3 digits of the ZIP code (gray = land with no ZIP code area)" : ""}.</p>
      </figcaption>
    </figure>
  );
}
