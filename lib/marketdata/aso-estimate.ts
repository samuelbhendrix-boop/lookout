import disclosures from "@/data/benchmarks/carrier-aso.json";

/**
 * Self-funded (ASO) lives by carrier and state, from the "uninsured plans" column of CMS's loss-ratio filings, with
 * estimates where carriers don't report by state. Three bases, in order of trust:
 *
 *  1. reported   The carrier filed self-funded lives for that state. Used as filed.
 *  2. allocated  The carrier filed its whole national self-funded book under one state (Aetna Life files everything
 *                under Connecticut). That total is spread across states in proportion to where the carrier's group
 *                (all companies in its filing group) has fully insured group members.
 *  3. disclosed  The carrier files no self-funded lives at all because a non-insurer subsidiary administers them
 *                (UnitedHealthcare). Its national total comes from its own annual results and is spread the same way.
 *
 * The spread assumes a carrier's self-funded business follows its fully insured group footprint. That is the usual
 * analyst approach when only national totals exist; it is checked against Massachusetts, where CHIA publishes actual
 * counts (see asoMethodCheck). Dental- or vision-only administrators (no comprehensive medical business anywhere) are
 * left out.
 */
export type AsoInput = { state: string; company: string; group: string | null; aso: number; memberMonths: number; fees: number; fiGroup: number; fiAll: number };
export type AsoRow = { state: string; company: string; groupName: string | null; lives: number; memberMonths: number | null; fees: number | null; basis: "reported" | "allocated" | "disclosed"; note: string | null };

type Disclosure = { brand: string; payer: string; pattern: string; byYear: Record<string, { selfFunded: number; fullyInsured?: number }>; why: string; source: string; url: string };
export const DISCLOSURES = (disclosures as unknown as { carriers: Disclosure[] }).carriers;

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

export function estimateAso(year: number, rows: AsoInput[]): AsoRow[] {
  const out: AsoRow[] = [];
  const byCompany = new Map<string, AsoInput[]>();
  for (const r of rows) (byCompany.get(r.company) ?? byCompany.set(r.company, []).get(r.company)!).push(r);
  const groupKey = (r: AsoInput) => r.group?.trim() || r.company;
  const byGroup = new Map<string, AsoInput[]>();
  for (const r of rows) (byGroup.get(groupKey(r)) ?? byGroup.set(groupKey(r), []).get(groupKey(r))!).push(r);
  const medical = (g: AsoInput[]) => sum(g.map((r) => r.fiAll)) >= 1000; // has comprehensive medical business somewhere

  // A regional group that files its whole self-funded book under its home state (Harvard Pilgrim files New Hampshire
  // and Maine accounts under Massachusetts): at least 90% of the group's self-funded lives sit in one state, which is
  // also its main fully insured market (50–85% of fully insured group lives), and the rest of its group business is
  // spread over a few other states. Spread that book by fully insured group footprint, like a national roll-up.
  const regional = new Set<string>();
  for (const [g, grp] of byGroup) {
    const asoBy = new Map<string, number>();
    for (const r of grp) if (r.aso > 0) asoBy.set(r.state, (asoBy.get(r.state) ?? 0) + r.aso);
    const asoTotal = sum([...asoBy.values()]);
    // Blue plans are left alone: their filed counts mix home-plan national accounts with local business by design.
    if (asoTotal < 20_000 || !medical(grp) || grp.some((r) => /blue (cross|shield)|premera|anthem|highmark|regence/i.test(r.company))) continue;
    const [home, homeAso] = [...asoBy.entries()].sort((a, b) => b[1] - a[1])[0];
    const foot = new Map<string, number>();
    for (const r of grp) if (r.fiGroup > 0) foot.set(r.state, (foot.get(r.state) ?? 0) + r.fiGroup);
    const footTotal = sum([...foot.values()]);
    const homeShare = (foot.get(home) ?? 0) / (footTotal || 1);
    if (homeAso / asoTotal < 0.9 || homeShare < 0.5 || homeShare > 0.85 || foot.size < 2 || foot.size > 10) continue;
    regional.add(g);
    const lead = grp.filter((r) => r.aso > 0).sort((a, b) => b.aso - a.aso)[0].company;
    for (const [state, fi] of foot) {
      out.push({ state, company: lead, groupName: grp[0].group, lives: Math.round((asoTotal * fi) / footTotal), memberMonths: null, fees: null, basis: "allocated",
        note: `${g} files ${Math.round((homeAso / asoTotal) * 100)}% of its self-funded book (${Math.round(asoTotal).toLocaleString()} lives) under ${home}; spread by where it has fully insured group members (${Math.round((fi / footTotal) * 1000) / 10}% in ${state}).` });
    }
  }

  for (const [company, cs] of byCompany) {
    const withAso = cs.filter((r) => r.aso > 0);
    if (!withAso.length) continue;
    const grp = byGroup.get(groupKey(cs[0]))!;
    if (!medical(grp) || regional.has(groupKey(cs[0]))) continue;
    const national = sum(withAso.map((r) => r.aso));
    // Fully insured group footprint of the whole filing group, by state.
    const foot = new Map<string, number>();
    for (const r of grp) if (r.fiGroup > 0) foot.set(r.state, (foot.get(r.state) ?? 0) + r.fiGroup);
    const footTotal = sum([...foot.values()]);
    const home = withAso.sort((a, b) => b.aso - a.aso)[0];
    // A roll-up: the company itself sells fully insured group coverage in many states but files self-funded lives in one.
    const ownStates = cs.filter((r) => r.fiGroup > 0).length;
    const rolledUp = withAso.length === 1 && national >= 1_000_000 && ownStates >= 10 && (foot.get(home.state) ?? 0) / (footTotal || 1) < 0.5;
    if (rolledUp) {
      for (const [state, fi] of foot) {
        out.push({ state, company, groupName: cs[0].group, lives: Math.round((national * fi) / footTotal), memberMonths: null, fees: null, basis: "allocated",
          note: `${company} files its whole self-funded book (${Math.round(national).toLocaleString()} lives) under ${home.state}; spread by where its group has fully insured group members (${Math.round((fi / footTotal) * 1000) / 10}% in ${state}).` });
      }
      continue;
    }
    for (const r of withAso) out.push({ state: r.state, company, groupName: r.group, lives: r.aso, memberMonths: r.memberMonths || null, fees: r.fees || null, basis: "reported", note: null });
  }

  // Carriers that report (almost) nothing because a non-insurer administers their self-funded plans.
  for (const d of DISCLOSURES) {
    const nat = d.byYear[String(year)] ?? d.byYear[String(Math.max(...Object.keys(d.byYear).map(Number)))];
    if (!nat) continue;
    const re = new RegExp(d.pattern, "i");
    const mine = rows.filter((r) => re.test(r.company));
    const foot = new Map<string, number>();
    for (const r of mine) if (r.fiGroup > 0) foot.set(r.state, (foot.get(r.state) ?? 0) + r.fiGroup);
    const footTotal = sum([...foot.values()]);
    if (!footTotal) continue;
    // Drop the little it did report so it isn't counted twice.
    for (let i = out.length - 1; i >= 0; i--) if (re.test(out[i].company)) out.splice(i, 1);
    for (const [state, fi] of foot) {
      out.push({ state, company: d.payer, groupName: d.brand, lives: Math.round((nat.selfFunded * fi) / footTotal), memberMonths: null, fees: null, basis: "disclosed",
        note: `${d.why} National self-funded membership (${nat.selfFunded.toLocaleString()}; ${d.source}) spread by where it has fully insured group members (${Math.round((fi / footTotal) * 1000) / 10}% in ${state}).` });
    }
  }
  return out.filter((r) => r.lives >= 50);
}
