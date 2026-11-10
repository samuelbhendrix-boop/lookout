/**
 * New England hospital directory for the network maps: every hospital in CMS's Hospital General Information
 * (all types — acute, critical access, children's, psychiatric, VA), located at its ZIP code's centroid
 * (Census ZCTA gazetteer). Also links IPPS-exempt hospitals (critical access, children's) to their rate-file TINs.
 *
 *   npx tsx scripts/build-hospital-directory.ts <2024_Gaz_zcta_national.txt>
 */
import { readFileSync, writeFileSync } from "node:fs";

const STATES = ["MA", "NH", "ME", "RI", "CT", "VT"];
type Row = { facility_id: string; facility_name: string; citytown: string; state: string; zip_code: string; hospital_type: string; hospital_ownership: string; hospital_overall_rating: string; emergency_services: string };

async function main() {
  const zc = new Map<string, [number, number]>();
  for (const line of readFileSync(process.argv[2], "utf8").split(/\r?\n/).slice(1)) {
    const c = line.split("\t");
    if (c.length > 6) zc.set(c[0].trim(), [Number(c[c.length - 2]), Number(c[c.length - 1])]);
  }
  const out: Array<Record<string, unknown>> = [];
  for (const st of STATES) {
    const url = `https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0?limit=500&conditions%5B0%5D%5Bproperty%5D=state&conditions%5B0%5D%5Bvalue%5D=${st}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PayersightBot; +https://github.com/samuelbhendrix-boop/lookout)" }, signal: AbortSignal.timeout(60_000) });
    const j = (await res.json()) as { results: Row[] };
    for (const r of j.results) {
      const z = r.zip_code.slice(0, 5);
      let ll = zc.get(z);
      let approx = false;
      if (!ll) {
        // PO-box ZIPs have no centroid: use the numerically nearest ZIP in the same 3-digit area.
        const near = [...zc.keys()].filter((k) => k.startsWith(z.slice(0, 3))).sort((a, b) => Math.abs(+a - +z) - Math.abs(+b - +z))[0];
        if (near) { ll = zc.get(near); approx = true; }
      }
      out.push({
        ccn: r.facility_id, name: r.facility_name, city: r.citytown, state: r.state, zip: r.zip_code.slice(0, 5),
        type: r.hospital_type, ownership: r.hospital_ownership, stars: Number(r.hospital_overall_rating) || null, er: r.emergency_services === "Yes",
        lat: ll?.[0] ?? null, lon: ll?.[1] ?? null, ...(approx ? { approx: true } : {}),
      });
    }
  }
  // Link IPPS-exempt hospitals (in hospital-tins.json "exempt", named in their reason text) to directory CCNs.
  const tins = JSON.parse(readFileSync("data/medicare/hospital-tins.json", "utf8"));
  const norm = (s: string) => s.toUpperCase().replace(/&/g, " AND ").replace(/'/g, "").replace(/\bST\b/g, "SAINT").replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((t) => t && !["THE", "INC", "HOSPITAL", "MEDICAL", "CENTER", "MEMORIAL", "OF", "AND", "HEALTH"].includes(t));
  const nonIpps: Record<string, string> = {};
  for (const [tin, why] of Object.entries(tins.exempt as Record<string, string>)) {
    const m = /^(.+?) \((?:[A-Z]{2}|[A-Za-z, ]+)\) —|^(.+?) —/.exec(why);
    const name = (m?.[1] ?? m?.[2] ?? "").trim();
    const st = /\(([A-Z]{2})\)/.exec(why)?.[1];
    const nt = norm(name);
    if (!nt.length) continue;
    const hit = out.filter((h) => (!st || h.state === st) && nt.every((t) => norm(String(h.name)).includes(t)));
    if (hit.length === 1) nonIpps[tin] = String(hit[0].ccn);
  }
  tins.nonIpps = nonIpps;
  writeFileSync("data/medicare/hospital-tins.json", JSON.stringify(tins, null, 2) + "\n");
  writeFileSync("data/networks/hospitals.json", JSON.stringify({ _about: "CMS Hospital General Information (data.cms.gov xubh-q36u) for New England, located at ZIP centroids (Census 2024 ZCTA gazetteer).", generated: new Date().toISOString().slice(0, 10), hospitals: out }));
  console.log(`${out.length} hospitals, ${out.filter((h) => h.lat == null).length} without coordinates, ${Object.keys(nonIpps).length} exempt TINs linked`);
}
main();
