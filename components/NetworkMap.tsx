import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import states from "us-atlas/states-10m.json";

/** Server-rendered SVG map of New England hospitals; no client JS. */
const FIPS: Record<string, string> = { MA: "25", NH: "33", ME: "23", RI: "44", CT: "09", VT: "50" };
const topo = states as unknown as Topology<{ states: GeometryCollection<{ name: string }> }>;
const all = feature(topo, topo.objects.states);

export type MapDot = { key: string; lat: number; lon: number; label: string; status: "in" | "outpatient" | "out" | "unknown" | "count"; count?: number; max?: number };

const COLORS = { in: "#047857", outpatient: "#d97706", out: "#d6d3d1", unknown: "#ffffff", count: "#1c1917" };

export function NetworkMap({ state, dots, width = 640, height = 520 }: { state: string; dots: MapDot[]; width?: number; height?: number }) {
  const ne = all.features.filter((f) => Object.values(FIPS).includes(String(f.id)));
  const focus = state === "all" ? ne : ne.filter((f) => String(f.id) === FIPS[state]);
  const proj = geoMercator().fitExtent([[12, 12], [width - 12, height - 12]], { type: "FeatureCollection", features: focus });
  const path = geoPath(proj);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`Hospital network map, ${state}`}>
      <rect width={width} height={height} fill="#fafaf9" />
      {ne.map((f) => (
        <path key={String(f.id)} d={path(f) ?? ""} fill={focus.includes(f) ? "#ffffff" : "#f5f5f4"} stroke="#d6d3d1" strokeWidth={1} />
      ))}
      {dots.map((d) => {
        const p = proj([d.lon, d.lat]);
        if (!p) return null;
        const r = d.status === "count" ? 3 + 7 * ((d.count ?? 0) / Math.max(1, d.max ?? 1)) : 5;
        return (
          <circle key={d.key} cx={p[0]} cy={p[1]} r={r} fill={COLORS[d.status]} fillOpacity={d.status === "count" ? 0.55 : 0.9}
            stroke={d.status === "unknown" ? "#78716c" : "#ffffff"} strokeWidth={1} strokeDasharray={d.status === "unknown" ? "2 2" : undefined}>
            <title>{d.label}</title>
          </circle>
        );
      })}
    </svg>
  );
}
