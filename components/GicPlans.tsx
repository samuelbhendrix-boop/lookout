import { gicByCarrier, gicDesignChanges, gicLatest, type GicPlan } from "@/lib/marketdata/gic";

const usd = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const int = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
const signed = (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`);
const head = "border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500";
const NET_ORDER = ["National", "Broad", "Limited", "Regional"];
const DESIGN_ROWS = ["type", "pcpRequired", "referral", "deductible", "oopInd", "oopFam", "pcp", "specialist", "urgent", "behavioral", "er", "inpatient", "surgery", "imaging", "rx", "mail"];

/**
 * GIC plans side by side: full monthly premium, increase, enrollment, and the benefit design. `match` highlights (and,
 * with `only`, limits to) one competitor's plans.
 */
export function GicPlans({ match, only = false }: { match?: (carrier: string) => boolean; only?: boolean }) {
  const year = gicLatest();
  const plans = year.plans.filter((p) => !only || match?.(p.carrier)).sort((a, b) => NET_ORDER.indexOf(a.network) - NET_ORDER.indexOf(b.network) || (b.premium.individual.current ?? 0) - (a.premium.individual.current ?? 0));
  if (!plans.length) return null;
  const changes = gicDesignChanges(year);
  const carriers = gicByCarrier(year);
  const mine = (p: GicPlan) => !!match?.(p.carrier);
  const avgInd = year.plans.reduce((s, p) => s + (p.premium.individual.current ?? 0), 0) / year.plans.length;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold tracking-tight">Public-employer benchmark · MA Group Insurance Commission, FY{year.fiscalYear}</h2>
        <p className="text-xs text-stone-500">
          The largest New England large-group buyer whose full benefit designs and premiums are public. GIC covers state and many municipal employees; plans
          are self-insured with the carrier as administrator, so premiums are GIC&apos;s full cost (employer + employee) per subscriber per month, effective {year.effective}.
          GIC&apos;s average non-Medicare increase: {signed(year.nonMedicareAvgIncrease)}.
        </p>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className={head}><tr><th className="px-3 py-2">Plan</th><th className="px-3 py-2">Network</th><th className="px-3 py-2 text-right">Individual / mo</th><th className="px-3 py-2 text-right">vs avg</th><th className="px-3 py-2 text-right">Family / mo</th><th className="px-3 py-2 text-right">Increase</th><th className="px-3 py-2 text-right">Subscribers</th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {plans.map((p) => {
              const subs = (p.premium.individual.enrollment ?? 0) + (p.premium.family.enrollment ?? 0);
              const vs = p.premium.individual.current ? p.premium.individual.current / avgInd - 1 : null;
              return (
                <tr key={p.id} className={mine(p) ? "bg-accent-soft/60" : ""}>
                  <td className="px-3 py-1.5"><span className="font-medium">{p.product}</span><div className="text-[10px] text-stone-500">{p.carrier} · {p.design.type}</div></td>
                  <td className="px-3 py-1.5 text-xs">{p.network}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(p.premium.individual.current)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${vs == null ? "" : vs < 0 ? "text-emerald-700" : "text-red-600"}`}>{signed(vs)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(p.premium.family.current)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{signed(p.premium.individual.change)}<div className="text-[10px] text-stone-400">family {signed(p.premium.family.change)}</div></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{subs ? int(subs) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="card" open={only}>
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium">Benefit designs side by side</summary>
        <div className="overflow-x-auto border-t border-stone-100">
          <table className="w-full text-xs">
            <thead className={head}><tr><th className="px-3 py-2">In-network</th>{plans.map((p) => <th key={p.id} className={`min-w-[110px] px-2 py-2 font-medium normal-case ${mine(p) ? "text-stone-900" : ""}`}>{p.product}</th>)}</tr></thead>
            <tbody className="divide-y divide-stone-100">
              {DESIGN_ROWS.filter((k) => year.labels[k]).map((k) => {
                const vals = plans.map((p) => p.design[k] ?? "—");
                const same = vals.every((v) => v === vals[0]);
                return (
                  <tr key={k} className={same ? "text-stone-400" : ""}>
                    <td className="whitespace-nowrap px-3 py-1.5 font-medium text-stone-700">{year.labels[k]}</td>
                    {vals.map((v, i) => <td key={plans[i].id} className={`px-2 py-1.5 ${mine(plans[i]) ? "bg-accent-soft/60" : ""}`}>{v.replace(/^Tier 1: /, "").replace(/ Tier \d: /g, " / ")}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-stone-500">Grey rows are identical across plans: GIC standardizes most cost sharing, so plans compete on network, premium and tiering. Tiered plans list tier 1 / 2 / 3. Prescription drugs also carry a $100 / $200 deductible in every plan.</p>
        </div>
      </details>

      {!only && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="card p-4 text-sm">
            <p className="mb-2 font-medium">By carrier · FY{year.fiscalYear}</p>
            <ul className="space-y-1.5">
              {carriers.map((c) => (
                <li key={c.carrier} className="flex justify-between gap-3"><span>{c.carrier} <span className="text-xs text-stone-400">{c.plans.length} plan{c.plans.length > 1 ? "s" : ""}</span></span><span className="tabular-nums text-stone-600">{int(c.subscribers)} · {c.share != null ? `${Math.round(c.share * 100)}%` : "—"} · {signed(c.change)}</span></li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-stone-500">Subscribers (GIC&apos;s open-enrollment projection), share, enrollment-weighted increase.</p>
          </div>
          <div className="card p-4 text-sm">
            <p className="mb-2 font-medium">Design changes from FY{changes?.prevYear ?? "—"}</p>
            {changes?.changes.length ? (
              <ul className="space-y-1 text-xs">{changes.changes.map((c, i) => <li key={i}><span className="font-medium">{c.plan}</span> · {c.field}: {c.before} → {c.after}</li>)}</ul>
            ) : <p className="text-xs text-stone-500">{changes ? "None. Every plan kept the same cost sharing; only premiums moved." : "No prior year on file."}</p>}
          </div>
        </div>
      )}
      <p className="text-[11px] text-stone-500">Sources: {year.sources.map((s, i) => <span key={s.url}>{i ? " · " : ""}<a className="underline" href={s.url}>{s.label}</a></span>)}.</p>
    </section>
  );
}
