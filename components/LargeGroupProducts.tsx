import Link from "next/link";
import { SIZE_BANDS, type LgRow, type ProductLine } from "@/lib/marketdata/lgbook";

const int = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const usd = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const k = (n: number | null | undefined) => (n == null ? "—" : `$${(n / 1000).toFixed(1)}K`);
const pct = (n: number | null | undefined, d = 0) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);
const signed = (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`);
const tone = (n: number | null | undefined, goodWhenLow = true) => (n == null || Math.abs(n) < 0.005 ? "" : (n < 0) === goodWhenLow ? "text-emerald-700" : "text-red-600");
const Th = ({ children, right = true }: { children: React.ReactNode; right?: boolean }) => <th className={`px-3 py-2 ${right ? "text-right" : ""}`}>{children}</th>;
const head = "border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500";

type Data = { state: string; rows: LgRow[]; mlrYear: number | null | undefined; enrollAsOf: Date | null | undefined; formYears: number[]; rateYear: number | null | undefined; finYear: number | null | undefined; marketPremPerPerson: number | null; marketRenewal: number | null };

function Name({ r, state }: { r: LgRow; state: string }) {
  return r.competitorId ? <Link className="font-medium hover:underline" href={`/competitors/${r.competitorId}/products?state=${state}#large-group`}>{r.label}</Link> : <span className="font-medium">{r.label}</span>;
}

/** Market view: every carrier's large-group book, pricing, renewals and margins in one state. */
export function LargeGroupMarket({ data }: { data: Data }) {
  const { rows, state } = data;
  const hasRate = rows.some((r) => r.rate);
  const hasAdmin = rows.some((r) => r.admin);
  const products = [...new Set(rows.flatMap((r) => Object.keys(r.products)))].filter((p) => p !== "Other").sort();
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-semibold tracking-tight">Book of business</h2>
        <p className="text-xs text-stone-500">Fully insured lives, premium and claims per member per month from CMS loss-ratio filings ({data.mlrYear ?? "—"}); self-insured members from {state === "MA" ? "CHIA enrollment" : "the state enrollment report"}{data.enrollAsOf ? ` (${data.enrollAsOf.toISOString().slice(0, 7)})` : ""}.</p>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={head}><tr><Th right={false}>Carrier</Th><Th>Fully insured lives</Th><Th>Share</Th><Th>vs prior yr</Th><Th>Self-insured</Th><Th>Premium PMPM</Th><Th>PMPM chg</Th><Th>Claims PMPM</Th><Th>Loss ratio</Th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-3 py-1.5"><Name r={r} state={state} /></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{int(r.lives ?? r.fullyInsured)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{pct(r.share, 1)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${tone(r.livesChange, false)}`}>{signed(r.livesChange)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{int(r.selfInsured)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(r.premiumPmpm)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${tone(r.pmpmChange)}`}>{signed(r.pmpmChange)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(r.claimsPmpm)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{pct(r.lossRatio, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold tracking-tight">Employer pricing and renewals · Form 5500</h2>
        <p className="text-xs text-stone-500">
          Fully insured employers based in {state} that file Form 5500 (100+ participants), plan years {data.formYears.join("–") || "—"}. Annual premium per covered person
          from Schedule A (median, with the middle half in grey). Renewal = median change in premium per person for the same employer staying with the same carrier, year over year.
          Market median {k(data.marketPremPerPerson)} per person{data.marketRenewal != null ? `, renewal ${signed(data.marketRenewal)}` : ""}.
        </p>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={head}><tr><Th right={false}>Carrier</Th><Th>Employers</Th><Th>Persons</Th><Th>Premium / person</Th>{SIZE_BANDS.map((b) => <Th key={b.label}>{b.label}</Th>)}<Th>Renewal</Th><Th>Broker pay</Th><Th>HMO share</Th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {rows.filter((r) => r.accounts > 0).sort((a, b) => b.persons - a.persons).map((r) => (
                <tr key={r.key}>
                  <td className="px-3 py-1.5"><Name r={r} state={state} /></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{int(r.accounts)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{int(r.persons)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{k(r.premPerPerson)}<div className="text-[10px] text-stone-400">{r.accounts >= 4 ? `${k(r.p25)}–${k(r.p75)}` : "few filings"}</div></td>
                  {SIZE_BANDS.map((b, i) => <td key={b.label} className="px-3 py-1.5 text-right tabular-nums text-stone-600">{k(r.byBand[i])}</td>)}
                  <td className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${tone(r.renewal != null && data.marketRenewal != null ? r.renewal - data.marketRenewal : null)}`}>{signed(r.renewal)}{r.renewals ? <div className="text-[10px] text-stone-400">n={r.renewals}</div> : null}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{pct(r.brokerPct, 1)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{pct(r.hmoShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {products.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold tracking-tight">Product mix · members by product type</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={head}><tr><Th right={false}>Carrier</Th>{products.map((p) => <Th key={p}>{p}</Th>)}</tr></thead>
              <tbody className="divide-y divide-stone-100">
                {rows.filter((r) => Object.keys(r.products).length).map((r) => {
                  const tot = Object.values(r.products).reduce((s, v) => s + v, 0) || 1;
                  return <tr key={r.key}><td className="px-3 py-1.5"><Name r={r} state={state} /></td>{products.map((p) => <td key={p} className="px-3 py-1.5 text-right tabular-nums">{r.products[p] ? <>{r.products[p] / tot < 0.005 ? "<1%" : pct(r.products[p] / tot)}<span className="text-[10px] text-stone-400"> {int(r.products[p])}</span></> : <span className="text-stone-300">—</span>}</td>)}</tr>;
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-stone-500">Fully and self-insured combined.</p>
        </section>
      )}

      {(hasRate || hasAdmin) && (
        <section className="space-y-2">
          <h2 className="font-semibold tracking-tight">{hasRate ? `Rate review · plan year ${data.rateYear}` : `Margins · ${data.finYear}`}</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={head}><tr><Th right={false}>Carrier</Th>{hasRate && <><Th>Members</Th><Th>Requested</Th><Th>Approved</Th><Th>Medical trend</Th><Th>Retention</Th></>}{hasAdmin && <><Th>Admin % premium</Th><Th>Underwriting margin</Th></>}</tr></thead>
              <tbody className="divide-y divide-stone-100">
                {rows.filter((r) => r.rate || r.admin).map((r) => (
                  <tr key={r.key}>
                    <td className="px-3 py-1.5"><Name r={r} state={state} /></td>
                    {hasRate && <><td className="px-3 py-1.5 text-right tabular-nums">{int(r.rate?.members)}</td><td className="px-3 py-1.5 text-right tabular-nums">{signed(r.rate?.requested)}</td><td className="px-3 py-1.5 text-right font-medium tabular-nums">{signed(r.rate?.approved)}</td><td className="px-3 py-1.5 text-right tabular-nums">{pct(r.rate?.trend, 1)}</td><td className="px-3 py-1.5 text-right tabular-nums">{pct(r.rate?.retention, 1)}</td></>}
                    {hasAdmin && <><td className="px-3 py-1.5 text-right tabular-nums">{pct(r.admin?.adminPct, 1)}</td><td className={`px-3 py-1.5 text-right tabular-nums ${tone(r.admin?.marginPct, false)}`}>{signed(r.admin?.marginPct)}</td></>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-stone-500">{hasRate ? "Rhode Island's OHIC reviews large-group rates every year; requested vs approved average change, with the carrier's filed medical trend and retention (admin + margin)." : "Maine Bureau of Insurance financial results, large-group segment."}</p>
        </section>
      )}
    </div>
  );
}

/** Competitor view: this carrier's large group across states, plus its product line-up. */
export function LargeGroupCompetitor({ perState, lines, totalPlans }: { perState: Array<{ data: Data; row: LgRow }>; lines: ProductLine[]; totalPlans: number }) {
  return (
    <section id="large-group" className="space-y-4 border-t border-stone-200 pt-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Large group</h2>
        <p className="text-xs text-stone-500">Large-group rates and benefit designs aren&apos;t publicly filed. This combines loss-ratio filings, state enrollment reports, employers&apos; Form 5500 filings, state rate reviews, and the plan names in the carrier&apos;s transparency index.</p>
      </div>
      {perState.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={head}><tr><Th right={false}>State</Th><Th>Fully insured lives</Th><Th>Share</Th><Th>vs prior yr</Th><Th>Self-insured</Th><Th>Premium PMPM</Th><Th>Loss ratio</Th><Th>Premium / person</Th><Th>vs market</Th><Th>Renewal</Th><Th>Rate approved</Th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {perState.map(({ data, row: r }) => (
                <tr key={data.state}>
                  <td className="px-3 py-1.5"><Link className="font-medium hover:underline" href={`/products?state=${data.state}&market=LG`}>{data.state}</Link></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{int(r.lives ?? r.fullyInsured)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{pct(r.share, 1)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${tone(r.livesChange, false)}`}>{signed(r.livesChange)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{int(r.selfInsured)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(r.premiumPmpm)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{pct(r.lossRatio, 1)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{k(r.premPerPerson)}{r.accounts ? <div className="text-[10px] text-stone-400">{r.accounts} employers</div> : null}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${tone(r.premPerPerson && data.marketPremPerPerson ? r.premPerPerson / data.marketPremPerPerson - 1 : null)}`}>{r.premPerPerson && data.marketPremPerPerson ? signed(r.premPerPerson / data.marketPremPerPerson - 1) : "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{signed(r.renewal)}{r.renewals ? <div className="text-[10px] text-stone-400">n={r.renewals}</div> : null}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.rate ? <>{signed(r.rate.approved)}<div className="text-[10px] text-stone-400">asked {signed(r.rate.requested)}</div></> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lines.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold tracking-tight">Product line-up · from {totalPlans.toLocaleString()} group plan names</h3>
          <p className="text-xs text-stone-500">Product families read from the plan names the carrier publishes for each employer group (insured and self-funded). Deductibles are as written in the plan names.</p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={head}><tr><Th right={false}>Product</Th><Th>Plans</Th><Th>Deductibles</Th><Th right={false}>Features</Th><Th right={false}>Example</Th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {lines.filter((l) => l.family !== "Other").slice(0, 20).map((l) => {
                  const d = [...new Set(l.deductibles)].sort((a, b) => a - b);
                  return (
                    <tr key={l.family} className="align-top">
                      <td className="px-3 py-1.5 font-medium">{l.family}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.plans}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{d.length ? (d.length === 1 ? usd(d[0]) : `${usd(d[0])}–${usd(d.at(-1))}`) : "—"}{d.length > 2 ? <div className="text-[10px] text-stone-400">{d.length} levels</div> : null}</td>
                      <td className="px-3 py-1.5 text-xs text-stone-600">{l.features.join(" · ") || "—"}</td>
                      <td className="max-w-[360px] truncate px-3 py-1.5 text-xs text-stone-500" title={l.examples.join("\n")}>{l.examples[0]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
