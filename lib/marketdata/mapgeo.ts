import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import states from "us-atlas/states-10m.json";

/** New England state outlines projected once (server side) into a fixed SVG space, for the interactive map. */
const FIPS: Record<string, string> = { MA: "25", NH: "33", ME: "23", RI: "44", CT: "09", VT: "50" };
const topo = states as unknown as Topology<{ states: GeometryCollection<{ name: string }> }>;
const all = feature(topo, topo.objects.states);
export const MAP_W = 720, MAP_H = 620;

export function neProjection() {
  const ne = all.features.filter((f) => Object.values(FIPS).includes(String(f.id)));
  const proj = geoMercator().fitExtent([[10, 10], [MAP_W - 10, MAP_H - 10]], { type: "FeatureCollection", features: ne });
  const path = geoPath(proj);
  const outlines = Object.entries(FIPS).map(([abbr, fips]) => {
    const f = ne.find((x) => String(x.id) === fips)!;
    const [[x0, y0], [x1, y1]] = path.bounds(f);
    return { abbr, d: path(f) ?? "", box: [x0, y0, x1, y1] as [number, number, number, number] };
  });
  return { project: (lon: number, lat: number) => proj([lon, lat]), outlines };
}
