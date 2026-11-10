/**
 * Builds data/geo/rating-areas.json: an SVG map of every New England state's ACA rating areas, pre-projected so the
 * app draws it with no map library.
 *
 * Definitions are CMS's State Gross Premium Rating Areas (cms.gov/CCIIO/.../<st>-gra, checked 2026-11-09):
 *  - CT: 8 areas, one per county.  ME: 5 areas, by county.  NH, RI, VT: one statewide area.
 *  - MA: 7 areas by 3-digit ZIP. Shapes come from Census ZCTAs (OpenDataDE/State-zip-code-GeoJSON on GitHub),
 *    merged by ZIP prefix. ZCTAs leave out unpopulated land (state forests, water), which shows as the gray state
 *    outline underneath.
 * Counties and state outlines: us-atlas 3.0.1 (Census cartographic boundaries, 1:10m).
 *
 *   npx tsx scripts/build-rating-areas.ts [path/to/ma_massachusetts_zip_codes_geo.min.json]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { geoConicConformal, geoPath, geoCentroid, geoArea } from "d3-geo";
import { feature, merge, mesh } from "topojson-client";
import { topology } from "topojson-server";
import { presimplify, simplify, quantile } from "topojson-simplify";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson";

const ZIP_SRC = "https://raw.githubusercontent.com/OpenDataDE/State-zip-code-GeoJSON/master/ma_massachusetts_zip_codes_geo.min.json";

const STATES: Record<string, { fips: string; areas: Record<string, string[]>; by: "county" | "zip3" | "state" }> = {
  CT: { fips: "09", by: "county", areas: { "Rating Area 1": ["Fairfield"], "Rating Area 2": ["Hartford"], "Rating Area 3": ["Litchfield"], "Rating Area 4": ["Middlesex"], "Rating Area 5": ["New Haven"], "Rating Area 6": ["New London"], "Rating Area 7": ["Tolland"], "Rating Area 8": ["Windham"] } },
  ME: { fips: "23", by: "county", areas: { "Rating Area 1": ["Cumberland", "Sagadahoc", "York"], "Rating Area 2": ["Knox", "Kennebec", "Lincoln", "Oxford"], "Rating Area 3": ["Androscoggin", "Waldo", "Franklin"], "Rating Area 4": ["Penobscot", "Somerset", "Piscataquis"], "Rating Area 5": ["Hancock", "Aroostook", "Washington"] } },
  MA: { fips: "25", by: "zip3", areas: { "Rating Area 1": ["010", "011", "012", "013"], "Rating Area 2": ["014", "015", "016"], "Rating Area 3": ["017", "020"], "Rating Area 4": ["018", "019"], "Rating Area 5": ["021", "022", "024"], "Rating Area 6": ["023", "027"], "Rating Area 7": ["025", "026"] } },
  NH: { fips: "33", by: "state", areas: { "Rating Area 1": ["Statewide"] } },
  RI: { fips: "44", by: "state", areas: { "Rating Area 1": ["Statewide"] } },
  VT: { fips: "50", by: "state", areas: { "Rating Area 1": ["Statewide"] } },
};

// Reference cities for orientation, with the rating area each sits in (checked against the definitions above).
const CITIES: Record<string, Array<[string, number, number]>> = {
  MA: [["Boston", -71.06, 42.36], ["Worcester", -71.80, 42.26], ["Springfield", -72.59, 42.10], ["Pittsfield", -73.25, 42.45], ["Lowell", -71.32, 42.63], ["Brockton", -71.02, 42.08], ["New Bedford", -70.93, 41.64], ["Hyannis", -70.28, 41.65]],
  CT: [["Hartford", -72.68, 41.76], ["New Haven", -72.93, 41.31], ["Bridgeport", -73.19, 41.19], ["Stamford", -73.54, 41.05], ["New London", -72.10, 41.36], ["Torrington", -73.12, 41.80], ["Willimantic", -72.21, 41.71]],
  ME: [["Portland", -70.26, 43.66], ["Augusta", -69.78, 44.31], ["Lewiston", -70.21, 44.10], ["Bangor", -68.77, 44.80], ["Presque Isle", -68.02, 46.68], ["Ellsworth", -68.42, 44.54]],
  NH: [["Manchester", -71.46, 42.99], ["Concord", -71.54, 43.21], ["Portsmouth", -70.76, 43.07], ["Berlin", -71.19, 44.47], ["Keene", -72.28, 42.93]],
  RI: [["Providence", -71.41, 41.82], ["Newport", -71.31, 41.49], ["Westerly", -71.83, 41.38]],
  VT: [["Burlington", -73.21, 44.48], ["Montpelier", -72.58, 44.26], ["Rutland", -72.97, 43.61], ["Brattleboro", -72.56, 42.85]],
};

const W = 520;

async function maZips(): Promise<FeatureCollection> {
  const local = process.argv[2];
  if (local && existsSync(local)) return JSON.parse(readFileSync(local, "utf8"));
  const res = await fetch(ZIP_SRC, { headers: { "user-agent": "Mozilla/5.0 (compatible; PayersightBot; +https://github.com/samuelbhendrix-boop/lookout)" } });
  if (!res.ok) throw new Error(`ZCTA download ${res.status}`);
  return res.json() as Promise<FeatureCollection>;
}

async function main() {
  const us = JSON.parse(readFileSync(require.resolve("us-atlas/counties-10m.json"), "utf8")) as Topology;
  const counties = feature(us, us.objects.counties as GeometryCollection) as FeatureCollection<Geometry, { name: string }>;
  const states = feature(us, us.objects.states as GeometryCollection) as FeatureCollection;
  const out: Record<string, unknown> = {};

  for (const [st, def] of Object.entries(STATES)) {
    const stateShape = states.features.find((f) => f.id === def.fips)!;
    const myCounties = counties.features.filter((f) => String(f.id).startsWith(def.fips));
    let areas: Array<{ id: string; members: string[]; geom: Geometry }>;

    if (def.by === "zip3") {
      const zips = await maZips();
      const zipKey = (f: Feature) => String((f.properties as Record<string, string>).ZCTA5CE10 ?? (f.properties as Record<string, string>).GEOID10 ?? "");
      const topo = topology({ z: { type: "FeatureCollection", features: zips.features.map((f) => ({ ...f, properties: { zip: zipKey(f) } })) } as FeatureCollection }, 1e5);
      const simp = simplify(presimplify(topo as never), quantile(presimplify(topo as never), 0.12)) as unknown as Topology;
      const geoms = (simp.objects.z as GeometryCollection).geometries as unknown as Array<{ properties: { zip: string } }>;
      areas = Object.entries(def.areas).map(([id, prefixes]) => ({
        id, members: prefixes,
        geom: merge(simp as never, geoms.filter((g) => prefixes.includes(g.properties.zip.slice(0, 3))) as never) as MultiPolygon,
      }));
      const unmatched = geoms.filter((g) => !Object.values(def.areas).flat().includes(g.properties.zip.slice(0, 3)));
      if (unmatched.length) console.warn(`MA: ${unmatched.length} ZCTAs with unknown prefixes`, unmatched.slice(0, 5).map((g) => g.properties.zip));
    } else if (def.by === "county") {
      const cg = (us.objects.counties as GeometryCollection).geometries as unknown as Array<{ id: string; properties: { name: string } }>;
      areas = Object.entries(def.areas).map(([id, names]) => {
        const geoms = cg.filter((g) => g.id.startsWith(def.fips) && names.includes(g.properties.name));
        if (geoms.length !== names.length) throw new Error(`${st} ${id}: found ${geoms.length} of ${names.length} counties`);
        return { id, members: names, geom: merge(us as never, geoms as never) as MultiPolygon };
      });
    } else {
      areas = [{ id: "Rating Area 1", members: ["Statewide"], geom: stateShape.geometry }];
    }

    const proj = geoConicConformal().parallels([41, 45]).rotate([71.5, 0]);
    proj.fitWidth(W, stateShape as never);
    const path = geoPath(proj).digits(1);
    const [[, y0], [, y1]] = path.bounds(stateShape as never);
    const H = Math.ceil(y1 - y0 + 2);
    proj.fitSize([W, H], stateShape as never);

    const countyLines = mesh(us as never, (us.objects.counties as GeometryCollection) as never, ((a: { id: string }, b: { id: string }) => a !== b && a.id.startsWith(def.fips) && b.id.startsWith(def.fips)) as never);
    out[st] = {
      width: W, height: H, by: def.by,
      outline: path(stateShape as never),
      counties: path(countyLines as never),
      countyNames: myCounties.map((c) => ({ name: c.properties.name, at: proj(geoCentroid(c as never))!.map((v) => Math.round(v)) })),
      areas: areas.map((a) => {
        // Label at the centroid of the area's largest piece, so multi-part areas (islands) label on the mainland.
        const polys: Polygon[] = a.geom.type === "MultiPolygon" ? (a.geom as MultiPolygon).coordinates.map((c) => ({ type: "Polygon", coordinates: c })) : [a.geom as Polygon];
        const big = polys.sort((p, q) => geoArea(q as never) - geoArea(p as never))[0];
        return { id: a.id, members: a.members, d: path(a.geom as never), at: proj(geoCentroid(big as never))!.map((v) => Math.round(v)) };
      }),
      cities: (CITIES[st] ?? []).map(([name, lon, lat]) => ({ name, at: proj([lon, lat])!.map((v) => Math.round(v)) })),
    };
    console.log(st, `${areas.length} areas`, `${W}x${H}`, `${Math.round(JSON.stringify(out[st]).length / 1024)}KB`);
  }
  mkdirSync("data/geo", { recursive: true });
  writeFileSync("data/geo/rating-areas.json", JSON.stringify({ source: "CMS State Gross Premium Rating Areas; Census ZCTA (MA) and us-atlas counties", built: new Date().toISOString().slice(0, 10), states: out }));
}

main().catch((e) => { console.error(e); process.exit(1); });
