/**
 * Proposes TIN → Medicare CCN matches for every provider billing inpatient DRGs, writing them to the "auto" section of
 * data/medicare/hospital-tins.json. Strict rules, so a wrong match is unlikely:
 *   - candidate names: every name the rate files use for the TIN, plus the IRS exempt-org register name
 *   - state must agree (IRS register state, else EIN prefix 01–06) with the hospital's state
 *   - accept only an exact normalized-name match, or full containment of the hospital's distinctive tokens (≥2),
 *     with a unique best candidate; everything else is printed for review.
 *
 *   npx tsx scripts/match-hospitals.ts [--write]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { db } from "../lib/db";

const ref = JSON.parse(readFileSync("data/medicare/reference.json", "utf8")) as { hospitals: Record<string, { name: string; state: string }> };
const irs = JSON.parse(readFileSync("data/irs/ne-health-orgs.json", "utf8")).orgs as Record<string, [string, string, string]>;
const npis = JSON.parse(readFileSync("data/npi/names.json", "utf8")).npis as Record<string, [string, string]>;
const file = JSON.parse(readFileSync("data/medicare/hospital-tins.json", "utf8")) as { map: Record<string, string>; exempt: Record<string, string>; reject?: Record<string, string>; auto?: Record<string, string>; _about: string };
const EIN_STATE: Record<string, string> = { "01": "ME", "02": "NH", "03": "VT", "04": "MA", "05": "RI", "06": "CT" };
const STOP = new Set("THE INC INCORPORATED CORP CORPORATION LLC CO OF AND AT CENTER CTR MEDICAL MED HOSPITAL HOSP HOSPITALS HEALTH HEALTHCARE SYSTEM SYSTEMS INPATIENT IN DBA A ASSOCIATION ASSN NORTHERN LIGHT UMASS MEMORIAL BAYSTATE BETH ISRAEL DEACONESS LIFESPAN BROWN UNIVERSITY NUVANCE YALE NEW HAVEN HARTFORD DARTMOUTH".split(" "));
const toks = (s: string) => new Set(s.toUpperCase().replace(/&/g, " AND ").replace(/'/g, "").replace(/\bST\b/g, "SAINT").replace(/\bMT\b/g, "MOUNT").match(/[A-Z0-9]+/g)?.filter((t) => !STOP.has(t)) ?? []);
const norm = (s: string) => [...toks(s)].sort().join(" ");

async function main() {
  const rows = await db.providerRate.findMany({ where: { codeType: { in: ["MS-DRG", "APR-DRG"] }, billingClass: "institutional" }, select: { tin: true, providerName: true }, distinct: ["tin", "providerName"] });
  const names = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = names.get(r.tin) ?? names.set(r.tin, new Set()).get(r.tin)!;
    if (r.providerName && !/^unknown$/i.test(r.providerName)) s.add(r.providerName);
    if (irs[r.tin]) s.add(irs[r.tin][0]);
    if (r.tin.startsWith("npi:") && npis[r.tin.slice(4)]) s.add(npis[r.tin.slice(4)][0]);
  }
  const auto: Record<string, string> = {};
  const review: string[] = [];
  const hospitals = Object.entries(ref.hospitals);
  for (const [tin, ns] of names) {
    if (file.map[tin] || file.exempt[tin] || file.reject?.[tin]) continue;
    const st = irs[tin]?.[1] ?? (tin.startsWith("npi:") ? npis[tin.slice(4)]?.[1] : EIN_STATE[tin.slice(0, 2)]);
    const scored: Array<{ ccn: string; name: string; score: number }> = [];
    for (const [ccn, h] of hospitals) {
      if (st && h.state !== st) continue;
      const ht = toks(h.name);
      let best = 0;
      for (const n of ns) {
        const nt = toks(n);
        if (!ht.size || !nt.size) continue;
        if (norm(n) === norm(h.name)) best = Math.max(best, 1);
        else if (ht.size >= 2 && [...ht].every((t) => nt.has(t))) best = Math.max(best, 0.9);
        else best = Math.max(best, [...ht].filter((t) => nt.has(t)).length / new Set([...ht, ...nt]).size * 0.8);
      }
      if (best > 0) scored.push({ ccn, name: h.name, score: best });
    }
    scored.sort((a, b) => b.score - a.score);
    const [a, b] = scored;
    const label = `${tin} [${st ?? "?"}] ${[...ns].join(" | ").slice(0, 90)}`;
    const prefixState = tin.startsWith("npi:") ? undefined : EIN_STATE[tin.slice(0, 2)];
    const prefixOk = !prefixState || !a || ref.hospitals[a.ccn].state === prefixState;
    if (a && a.score >= 0.9 && st && prefixOk && (!b || b.score < a.score)) auto[tin] = a.ccn, console.log(`AUTO   ${label}  →  ${a.ccn} ${a.name}`);
    else review.push(`REVIEW ${label}  →  ${a ? `${a.ccn} ${a.name} (${a.score.toFixed(2)})` : "no candidate"}${b ? ` / ${b.ccn} ${b.name} (${b.score.toFixed(2)})` : ""}`);
  }
  review.forEach((r) => console.log(r));
  console.log(`\n${Object.keys(auto).length} auto, ${review.length} for review, ${Object.keys(file.map).length} reviewed`);
  if (process.argv.includes("--write")) {
    file.auto = auto;
    writeFileSync("data/medicare/hospital-tins.json", JSON.stringify(file, null, 2) + "\n");
  }
  await db.$disconnect();
}
main();
