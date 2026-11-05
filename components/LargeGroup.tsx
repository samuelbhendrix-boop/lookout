import Link from "next/link";
import type { competitorLargeGroup, marketLargeGroup } from "@/lib/marketdata/largegroup";
import { SOURCE_INFO } from "@/lib/marketdata/largegroup";
import { ShareBar, Sparkline, fmtInt, fmtMoneyM, fmtPct, fmtSignedPct, deltaClass, lrClass } from "./charts";

type Profile = Awaited<ReturnType<typeof competitorLargeGroup>>;
type Market = Awaited<ReturnType<typeof marketLargeGroup>>;

const Src = ({ id }: { id: string }) =>
  SOURCE_INFO[id] ? (
    <a className="underline decoration-stone-300 hover:decoration-stone-600" href={SOURCE_INFO[id].url} target="_blank" rel="noopener noreferrer">{SOURCE_INFO[id].label}</a>
  ) : <>{id}</>;

const quarter = (d: Date) => `${d.toISOString().slice(0, 7)}`;
const TH = "px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-stone-500";

// ─── Competitor profile section ──────────────────────────────────────

export function CompetitorLargeGroup({ data, serffStates }: { data: Profile; serffStates: string[] }) {
  const empty = !data.enrollment.length && !data.financials.length && !data.rateActions.length;
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Large group</h2>
        <p className="text-xs text-stone-500">State-published data, including self-insured (ASO) membership that CMS data can&apos;t see. Coverage differs by state; each block cites its source.</p>
      </div>

      {empty && <p className="text-sm text-stone-500">No state large-group data matched for this competitor yet.</p>}

      {data.enrollment.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.enrollment.map((b) => {
            const total = b.latest.fully + b.latest.self;
            const prevTotal = b.yearAgo ? b.yearAgo.fully + b.yearAgo.self : null;
            const yoy = prevTotal ? total / prevTotal - 1 : null;
            return (
              <div key={`${b.source}${b.state}`} className="card p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-mono text-[11px] uppercase tracking-wide text-stone-500">{b.state} large group members · {b.estimated ? b.latest.asOf.getUTCFullYear() : quarter(b.latest.asOf)}</p>
                  <Sparkline values={b.series.map((p) => p.fully + p.self)} />
                </div>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{b.estimated ? "≈" : ""}{fmtInt(total)}</p>
                <p className="text-xs text-stone-500">
                  <span className={deltaClass(yoy)}>{fmtSignedPct(yoy)}</span> YoY · {fmtPct(b.marketTotal ? total / b.marketTotal : null)} of {b.state} large group
                </p>
                <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-stone-100" title="Self-insured vs fully insured">
                  <div className="bg-stone-700" style={{ width: `${(100 * b.latest.self) / (total || 1)}%` }} />
                  <div className="bg-accent" style={{ width: `${(100 * b.latest.fully) / (total || 1)}%` }} />
                </div>
                <p className="mt-1 flex justify-between text-xs">
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-stone-700" />Self-insured {fmtInt(b.latest.self)}</span>
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" />Fully insured {fmtInt(b.latest.fully)}</span>
                </p>
                {b.bySector.length > 1 && (
                  <table className="mt-3 w-full text-xs">
                    <tbody className="divide-y divide-stone-100">
                      {b.bySector.map((s) => (
                        <tr key={s.sector}>
                          <td className="py-1 text-stone-600">{s.sector}</td>
                          <td className="py-1 text-right tabular-nums">{fmtInt(s.self + s.fully)}</td>
                          <td className="py-1 text-right tabular-nums text-stone-500">{fmtPct((s.self) / ((s.self + s.fully) || 1), 0)} self</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="mt-3 text-[11px] text-stone-400">Source: <Src id={b.source} />{b.notes.length > 0 && <> · {b.notes.join(" · ")}</>}</p>
              </div>
            );
          })}
        </div>
      )}

      {data.financials.length > 0 && (
        <div className="card overflow-x-auto">
          <p className="px-4 pt-3 text-sm font-medium">Fully insured large group results (state filing)</p>
          <table className="w-full text-sm">
            <thead className="text-left"><tr>
              <th className={TH}>Year</th><th className={TH}>State</th><th className={`${TH} text-right`}>Lives</th><th className={`${TH} text-right`}>Premium</th>
              <th className={`${TH} text-right`}>Loss ratio</th><th className={`${TH} text-right`}>Admin</th><th className={`${TH} text-right`}>Underwriting gain</th><th className={`${TH} text-right`}>Prem. share</th>
            </tr></thead>
            <tbody className="divide-y divide-stone-100">
              {[...data.financials].reverse().map((f) => {
                const margin = f.premium ? (f.underwritingGain ?? 0) / f.premium : null;
                return (
                  <tr key={`${f.state}${f.year}${f.company}`}>
                    <td className="px-3 py-1.5 tabular-nums">{f.year}</td>
                    <td className="px-3 py-1.5">{f.state}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(f.coveredLives)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoneyM(f.premium)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${lrClass(f.premium ? f.claims / f.premium : null)}`}>{fmtPct(f.premium ? f.claims / f.premium : null)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtPct(f.premium && f.adminExpense != null ? f.adminExpense / f.premium : null)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${(f.underwritingGain ?? 0) < 0 ? "text-red-600" : "text-emerald-700"}`}>
                      {f.underwritingGain == null ? "—" : `${f.underwritingGain < 0 ? "−" : ""}${fmtMoneyM(Math.abs(f.underwritingGain))}`} <span className="text-xs">({fmtSignedPct(margin)})</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtPct(f.marketPremium ? f.premium / f.marketPremium : null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 pb-3 text-[11px] text-stone-400">Source: <Src id={data.financials[0].source} /></p>
        </div>
      )}

      {data.rateActions.length > 0 && (
        <div className="card overflow-x-auto">
          <p className="px-4 pt-3 text-sm font-medium">Large group rate actions (regulator review)</p>
          <table className="w-full text-sm">
            <thead className="text-left"><tr>
              <th className={TH}>Plan year</th><th className={TH}>Filed as</th><th className={`${TH} text-right`}>Members</th>
              <th className={`${TH} text-right`}>Requested</th><th className={`${TH} text-right`}>Approved</th><th className={`${TH} text-right`}>Market approved</th><th className={TH}>Assumptions</th>
            </tr></thead>
            <tbody className="divide-y divide-stone-100">
              {data.rateActions.map((a) => (
                <tr key={`${a.state}${a.planYear}${a.carrier}`} className="align-top">
                  <td className="px-3 py-1.5 tabular-nums">{a.state} {a.planYear}</td>
                  <td className="px-3 py-1.5">{a.label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(a.members)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtSignedPct(a.requested)}</td>
                  <td className={`px-3 py-1.5 text-right font-medium tabular-nums ${a.approved != null && a.approved > 0.1 ? "text-red-600" : ""}`}>{fmtSignedPct(a.approved)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{fmtSignedPct(a.market?.approved ?? null)}</td>
                  <td className="px-3 py-1.5 text-xs text-stone-600">
                    {a.details ? (
                      <details><summary className="cursor-pointer">medical trend {fmtPct(a.details.medicalTrendTotal)} · retention {fmtPct(a.details.totalRetention)}</summary>
                        <ul className="mt-1 grid grid-cols-2 gap-x-4">
                          {Object.entries(a.details).map(([k, v]) => <li key={k} className="flex justify-between gap-2"><span>{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span><span className="tabular-nums">{fmtPct(v)}</span></li>)}
                        </ul>
                      </details>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 pb-3 text-[11px] text-stone-400">Source: <Src id="ri_ohic" /></p>
        </div>
      )}

      {serffStates.length > 0 && (
        <p className="text-xs text-stone-500">
          Large group rate & form filings in SERFF:{" "}
          {serffStates.map((s, i) => (
            <span key={s}>{i > 0 && " · "}<a className="underline" href={`https://filingaccess.serff.com/sfa/home/${s}`} target="_blank" rel="noopener noreferrer">{s}</a></span>
          ))}{" "}— search by company, Type of Insurance “H16G Group Health – Major Medical”, filtering for large group. Not every state requires large-group rate filings.
        </p>
      )}
    </section>
  );
}

// ─── Market page panels ──────────────────────────────────────────────

export function MarketLargeGroup({ data, state }: { data: Market; state: string }) {
  const e = data.enrollment;
  return (
    <>
      {e && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{state} large group incl. self-insured · {e.estimated ? e.asOf.getUTCFullYear() : quarter(e.asOf)}</h2>
            <p className="text-sm text-stone-500">{e.estimated ? "≈" : ""}{fmtInt(e.total)} members · {fmtPct(e.total ? e.totalSelf / e.total : null, 0)} self-insured</p>
          </div>
          <p className="text-xs text-stone-500">All large-group members by carrier, fully insured and self-insured (ASO). Source: <Src id={e.source} />.</p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left"><tr>
                <th className={TH}>Carrier</th><th className={`${TH} w-1/4`}>Share</th><th className={`${TH} text-right`}>Members</th>
                <th className={`${TH} text-right`}>Self-insured</th><th className={`${TH} text-right`}>Fully insured</th><th className={`${TH} text-right`}>YoY</th>
              </tr></thead>
              <tbody className="divide-y divide-stone-100">
                {e.rows.map((r) => (
                  <tr key={r.key}>
                    <td className="px-3 py-2">{r.competitorId ? <Link className="font-medium hover:underline" href={`/competitors/${r.competitorId}?state=${state}`}>{r.label}</Link> : <span className="text-stone-600">{r.label}</span>}</td>
                    <td className="px-3 py-2"><div className="flex items-center gap-2"><ShareBar share={r.share} highlight={!!r.competitorId} /><span className="w-12 text-right tabular-nums">{fmtPct(r.share)}</span></div></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.self)} <span className="text-xs text-stone-400">{fmtPct(r.selfShare, 0)}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.fully)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${deltaClass(r.yoy)}`}>{fmtSignedPct(r.yoy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data.financials && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">{state} fully insured large group results · {data.financials.year}</h2>
          <p className="text-xs text-stone-500">Profitability as filed with the state regulator. Source: <Src id={data.financials.source ?? ""} />.</p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left"><tr>
                <th className={TH}>Carrier</th><th className={`${TH} text-right`}>Lives</th><th className={`${TH} text-right`}>Premium</th>
                <th className={`${TH} text-right`}>Loss ratio</th><th className={`${TH} text-right`}>Admin</th><th className={`${TH} text-right`}>UW margin</th><th className={`${TH} text-right`}>Prior yr margin</th>
              </tr></thead>
              <tbody className="divide-y divide-stone-100">
                {data.financials.rows.map((r) => {
                  const m = r.premium ? (r.underwritingGain ?? 0) / r.premium : null;
                  const pm = r.prior?.premium ? (r.prior.underwritingGain ?? 0) / r.prior.premium : null;
                  return (
                    <tr key={r.company}>
                      <td className="px-3 py-2">{r.competitorId ? <Link className="font-medium hover:underline" href={`/competitors/${r.competitorId}?state=${state}`}>{r.label}</Link> : <span className="text-stone-600">{r.label}</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.coveredLives)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoneyM(r.premium)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${lrClass(r.premium ? r.claims / r.premium : null)}`}>{fmtPct(r.premium ? r.claims / r.premium : null)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.premium && r.adminExpense != null ? r.adminExpense / r.premium : null)}</td>
                      <td className={`px-3 py-2 text-right font-medium tabular-nums ${(m ?? 0) < 0 ? "text-red-600" : "text-emerald-700"}`}>{fmtSignedPct(m)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${(pm ?? 0) < 0 ? "text-red-600" : "text-stone-500"}`}>{fmtSignedPct(pm)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data.rateActions.map((ra) => (
        <section key={ra.planYear} className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">{state} large group rate decisions · {ra.planYear}</h2>
          <p className="text-xs text-stone-500">Requested vs approved by the regulator; market average approved {fmtSignedPct(ra.total?.approved ?? null)}. Source: <Src id={ra.source} />.</p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left"><tr>
                <th className={TH}>Carrier</th><th className={`${TH} text-right`}>Members</th><th className={`${TH} text-right`}>Requested</th><th className={`${TH} text-right`}>Approved</th><th className={`${TH} text-right`}>Cut by regulator</th>
              </tr></thead>
              <tbody className="divide-y divide-stone-100">
                {ra.rows.map((r) => (
                  <tr key={r.carrier}>
                    <td className="px-3 py-2">{r.competitorId ? <Link className="font-medium hover:underline" href={`/competitors/${r.competitorId}?state=${state}`}>{r.label}</Link> : <span className="text-stone-600">{r.label}</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.members)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtSignedPct(r.requested)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtSignedPct(r.approved)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-500">{r.requested != null && r.approved != null ? `${((r.requested - r.approved) * 100).toFixed(1)} pts` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
