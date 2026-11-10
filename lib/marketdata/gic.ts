import fy2026 from "../../data/gic/gic-fy2026.json";
import fy2027 from "../../data/gic/gic-fy2027.json";

/**
 * MA Group Insurance Commission plans: the one public window into large-group benefit designs and premiums. GIC covers
 * ~450,000 state and municipal employees, retirees and dependents through Harvard Pilgrim (Point32Health), Wellpoint
 * (Elevance's UniCare), MGB Health Plan and Health New England. Rebuilt each spring with scripts/build-gic.ts.
 */
export type GicTier = { prior: number | null; current: number | null; change: number | null; enrollment: number | null };
export type GicPlan = { id: string; name: string; product: string; carrier: string; network: string; type: string; design: Record<string, string>; premium: { individual: GicTier; family: GicTier } };
export type GicYear = { fiscalYear: number; effective: string; nonMedicareAvgIncrease: number | null; note: string; sources: Array<{ label: string; url: string }>; labels: Record<string, string>; plans: GicPlan[] };

export const GIC_YEARS: GicYear[] = [fy2026, fy2027].map((y) => y as GicYear).sort((a, b) => a.fiscalYear - b.fiscalYear);
export const gicLatest = () => GIC_YEARS[GIC_YEARS.length - 1];

/** Benefit design changes from the previous fiscal year, per plan. */
export function gicDesignChanges(year = gicLatest()) {
  const prev = GIC_YEARS.find((y) => y.fiscalYear === year.fiscalYear - 1);
  if (!prev) return null;
  const out: Array<{ plan: string; field: string; before: string; after: string }> = [];
  for (const p of year.plans) {
    const q = prev.plans.find((x) => x.id === p.id);
    if (!q) { out.push({ plan: p.product, field: "Plan", before: "—", after: "new" }); continue; }
    for (const k of Object.keys(year.labels)) if ((q.design[k] ?? "") !== (p.design[k] ?? "")) out.push({ plan: p.product, field: year.labels[k], before: q.design[k] ?? "—", after: p.design[k] ?? "—" });
  }
  for (const q of prev.plans) if (!year.plans.some((p) => p.id === q.id)) out.push({ plan: q.product, field: "Plan", before: "offered", after: "dropped" });
  return { prevYear: prev.fiscalYear, changes: out };
}

/** Enrollment-weighted average increase per carrier (individual + family subscribers). */
export function gicByCarrier(year = gicLatest()) {
  const m = new Map<string, { carrier: string; subscribers: number; weighted: number; plans: string[] }>();
  for (const p of year.plans) {
    const a = m.get(p.carrier) ?? m.set(p.carrier, { carrier: p.carrier, subscribers: 0, weighted: 0, plans: [] }).get(p.carrier)!;
    a.plans.push(p.product);
    for (const t of [p.premium.individual, p.premium.family]) if (t.enrollment && t.change != null) { a.subscribers += t.enrollment; a.weighted += t.enrollment * t.change; }
  }
  const total = [...m.values()].reduce((s, a) => s + a.subscribers, 0);
  return [...m.values()].map((a) => ({ ...a, share: total ? a.subscribers / total : null, change: a.subscribers ? a.weighted / a.subscribers : null })).sort((a, b) => b.subscribers - a.subscribers);
}
