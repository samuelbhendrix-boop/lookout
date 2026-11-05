import Link from "next/link";
import { notFound } from "next/navigation";
import type { Segment } from "@prisma/client";
import { getSession, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { competitorProfile, type SegmentYear } from "@/lib/marketdata/queries";
import { Sparkline, fmtInt, fmtMoneyM, fmtPct, fmtSignedPct, fmtUsd, lrClass, deltaClass, SEGMENT_LABEL } from "@/components/charts";
import { Empty, Importance, TypeBadge, timeAgo } from "@/components/ui";
import { IssuerPatternEditor } from "@/components/IssuerPatternEditor";

export const dynamic = "force-dynamic";

const SEGMENTS: Segment[] = ["LARGE_GROUP", "SMALL_GROUP", "INDIVIDUAL"];
const serffLink = (state: string) => `https://filingaccess.serff.com/sfa/home/${state}`;

export default async function CompetitorProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ state?: string }>;
}) {
  const { id } = await params;
  const { state } = await searchParams;
  const session = (await getSession())!;
  const comp = await db.competitor.findFirst({ where: { id, workspaceId: session.workspaceId } });
  if (!comp) notFound();

  const [profile, allStates, signals, importsDone] = await Promise.all([
    competitorProfile(comp, state),
    state ? competitorProfile(comp).then((p) => p.states) : null,
    db.signal.findMany({
      where: { workspaceId: session.workspaceId, competitorId: comp.id, duplicateOfId: null, status: { not: "ARCHIVED" } },
      orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      take: 6,
    }),
    db.dataImport.count({ where: { status: "done" } }),
  ]);
  const states = allStates ?? profile.states;
  const years = [...new Set(profile.performance.map((p) => p.year))].sort();
  const latestYear = years[years.length - 1];
  const get = (seg: Segment, y: number) => profile.performance.find((p) => p.segment === seg && p.year === y);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/competitors" className="text-sm text-stone-500 hover:text-stone-900">← Competitors</Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{comp.name}</h1>
            <p className="text-sm text-stone-500">
              Tier {comp.tier}
              {comp.website && <> · <a className="underline" href={comp.website} target="_blank" rel="noopener noreferrer">website</a></>}
              {" · "}<Link className="underline" href={`/feed?competitorId=${comp.id}`}>all signals</Link>
            </p>
          </div>
        </div>
        {/* State filter */}
        {states.length > 0 && (
          <nav className="mt-4 flex flex-wrap gap-1 text-sm">
            <StateTab href={`/competitors/${comp.id}`} active={!state} label="All states" />
            {states.map((s) => <StateTab key={s} href={`/competitors/${comp.id}?state=${s}`} active={state === s} label={s} />)}
          </nav>
        )}
      </div>

      {importsDone === 0 ? (
        <Empty title="Market data is loading">
          Public filings are importing in the background (a few minutes on first deploy). Refresh shortly — progress is on the Settings page.
        </Empty>
      ) : profile.entities.length === 0 ? (
        <Empty title="No public filings matched">
          No legal entities in the CMS data match this competitor{state ? ` in ${state}` : ""}. Adjust the filing-name match below.
        </Empty>
      ) : null}

      {/* ── Performance ── */}
      {profile.performance.length > 0 && (
        <section className="space-y-3">
          <SectionTitle
            title="Performance"
            note={`Fully insured comprehensive medical, from CMS medical loss ratio reports (${years[0]}–${latestYear}). Self-funded/ASO business is not included.`}
          />
          <div className="grid gap-3 md:grid-cols-3">
            {SEGMENTS.map((seg) => {
              const cur = get(seg, latestYear);
              const prev = get(seg, latestYear - 1);
              if (!cur) return <div key={seg} className="card p-4 text-sm text-stone-400">{SEGMENT_LABEL[seg]}: no fully insured business reported</div>;
              const livesDelta = prev?.coveredLives ? cur.coveredLives / prev.coveredLives - 1 : null;
              return (
                <div key={seg} className="card p-4">
                  <div className="flex items-baseline justify-between">
                    <p className="font-mono text-[11px] uppercase tracking-wide text-stone-500">{SEGMENT_LABEL[seg]} · {latestYear}</p>
                    <Sparkline values={years.map((y) => get(seg, y)?.coveredLives ?? null)} />
                  </div>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{fmtInt(cur.coveredLives)}</p>
                  <p className="text-xs text-stone-500">
                    covered lives <span className={deltaClass(livesDelta)}>{fmtSignedPct(livesDelta)}</span> vs {latestYear - 1}
                  </p>
                  <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                    <dt className="text-stone-500">Premium</dt><dd className="text-right tabular-nums">{fmtMoneyM(cur.premium)}</dd>
                    <dt className="text-stone-500">Loss ratio</dt><dd className={`text-right tabular-nums ${lrClass(cur.lossRatio)}`}>{fmtPct(cur.lossRatio)}</dd>
                    <dt className="text-stone-500">Premium PMPM</dt><dd className="text-right tabular-nums">{fmtUsd(cur.premiumPmpm)}</dd>
                    <dt className="text-stone-500">Broker comp</dt><dd className="text-right tabular-nums">{fmtPct(cur.premium ? cur.brokerFees / cur.premium : null)}</dd>
                  </dl>
                </div>
              );
            })}
          </div>
          <details className="card">
            <summary className="cursor-pointer px-4 py-2 text-sm text-stone-600">Full history by year</summary>
            <PerformanceTable rows={profile.performance} />
          </details>
        </section>
      )}

      {/* ── Products ── */}
      {profile.products.length > 0 && (
        <section className="space-y-3">
          <SectionTitle
            title={`Products · plan year ${profile.planYear}`}
            note="Individual & small group (ACA single risk pool) from CMS rate review filings. Large-group products aren't publicly filed. Rate change = enrollment-weighted across renewing plans."
          />
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[11px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Product</th><th className="px-3 py-2">Market</th><th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Plans</th><th className="px-3 py-2 text-right">Enrolled</th>
                  <th className="px-3 py-2 text-right">Rate chg</th><th className="px-3 py-2 text-right">Avg PMPM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {profile.products.map((p) => (
                  <tr key={p.key} className="align-top">
                    <td className="px-3 py-2">
                      <details>
                        <summary className="cursor-pointer font-medium">{p.productName}</summary>
                        <p className="mt-1 text-xs text-stone-500">{p.company} · {p.productId}</p>
                        <ul className="mt-2 space-y-1 text-xs">
                          {p.plans.map((pl) => (
                            <li key={pl.planId} className="flex flex-wrap gap-x-3">
                              <span className={pl.category === "Terminated" ? "text-stone-400 line-through" : ""}>{pl.planName}</span>
                              <span className="text-stone-500">{pl.metal}{pl.onExchange ? " · exchange" : ""}</span>
                              {pl.category === "New" && <span className="rounded bg-emerald-50 px-1 text-emerald-700">new</span>}
                              {pl.category === "Terminated" && <span className="rounded bg-stone-100 px-1 text-stone-500">terminated</span>}
                              <span className="tabular-nums text-stone-600">{fmtSignedPct(pl.rateChange)} · {fmtUsd(pl.ratePmpm)} · {fmtInt(pl.enrollment)} enr</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{p.state} {p.market}</td>
                    <td className="px-3 py-2">{p.planType ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {p.activePlans}
                      {p.newPlans > 0 && <span className="text-emerald-700"> +{p.newPlans}</span>}
                      {p.terminatedPlans > 0 && <span className="text-red-600"> −{p.terminatedPlans}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(p.enrollment)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${p.avgRateChange != null && p.avgRateChange > 0.1 ? "text-red-600" : ""}`}>{fmtSignedPct(p.avgRateChange)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(p.avgPremiumPmpm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Filings ── */}
      {profile.filings.length > 0 && (
        <section className="space-y-3">
          <SectionTitle
            title="Rate filings"
            note="Each links to the state's SERFF Filing Access search — paste the SERFF number there for the full actuarial memorandum."
          />
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[11px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Effective</th><th className="px-3 py-2">Market</th><th className="px-3 py-2">Filed by</th>
                  <th className="px-3 py-2">SERFF #</th><th className="px-3 py-2 text-right">Rate chg</th>
                  <th className="px-3 py-2 text-right">Enrolled</th><th className="px-3 py-2 text-right">Exp. loss ratio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {profile.filings.map((f) => {
                  const lr = f.expPremium ? (f.expClaims ?? 0) / f.expPremium : null;
                  return (
                    <tr key={f.id}>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{f.effectiveDate.toISOString().slice(0, 10)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{f.state} {f.market}</td>
                      <td className="px-3 py-2 text-xs text-stone-600">{f.company}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                        {f.serffNumber ? (
                          <a className="underline" href={serffLink(f.state)} target="_blank" rel="noopener noreferrer" title="Open SERFF Filing Access for this state">{f.serffNumber}</a>
                        ) : "—"}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${f.avgRateChange != null && f.avgRateChange > 0.1 ? "text-red-600" : ""}`}>{fmtSignedPct(f.avgRateChange)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(f.enrollment)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${lrClass(lr)}`}>{fmtPct(lr)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Signals ── */}
      <section className="space-y-3">
        <SectionTitle title="Recent signals" />
        {signals.length === 0 ? (
          <p className="text-sm text-stone-500">No signals yet.</p>
        ) : (
          <ul className="card divide-y divide-stone-100">
            {signals.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <TypeBadge type={s.type} />
                <Link href={`/signals/${s.id}`} className="min-w-0 flex-1 truncate hover:underline">{s.title}</Link>
                <Importance value={s.importance} />
                <span className="font-mono text-xs text-stone-400">{timeAgo(s.publishedAt ?? s.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Entity mapping ── */}
      <section className="space-y-3">
        <SectionTitle title="Filing companies" note="Legal entities in public filings attributed to this competitor." />
        <div className="card p-4 text-sm">
          {profile.entities.length > 0 && (
            <ul className="mb-4 grid gap-1 sm:grid-cols-2">
              {[...new Map(profile.entities.map((e) => [`${e.state}|${e.company}`, e])).values()].map((e) => (
                <li key={`${e.state}|${e.company}`} className="text-stone-700"><span className="font-mono text-xs text-stone-400">{e.state}</span> {e.company}</li>
              ))}
            </ul>
          )}
          {hasRole(session.role, "ANALYST") ? (
            <IssuerPatternEditor competitorId={comp.id} pattern={profile.pattern} custom={!!comp.issuerPattern} />
          ) : (
            <p className="font-mono text-xs text-stone-500">Match: {profile.pattern}</p>
          )}
        </div>
      </section>
    </div>
  );
}

function StateTab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} className={`rounded-md px-2.5 py-1 ${active ? "bg-stone-900 text-white" : "border border-stone-200 bg-white text-stone-600 hover:border-stone-400"}`}>
      {label}
    </Link>
  );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {note && <p className="text-xs text-stone-500">{note}</p>}
    </div>
  );
}

function PerformanceTable({ rows }: { rows: SegmentYear[] }) {
  return (
    <div className="overflow-x-auto border-t border-stone-100">
      <table className="w-full text-sm">
        <thead className="text-left font-mono text-[11px] uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2">Year</th><th className="px-3 py-2">Segment</th><th className="px-3 py-2 text-right">Lives</th>
            <th className="px-3 py-2 text-right">Premium</th><th className="px-3 py-2 text-right">Claims</th>
            <th className="px-3 py-2 text-right">Loss ratio</th><th className="px-3 py-2 text-right">PMPM</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {[...rows].reverse().map((r) => (
            <tr key={`${r.year}${r.segment}`}>
              <td className="px-3 py-1.5 tabular-nums">{r.year}</td>
              <td className="px-3 py-1.5">{SEGMENT_LABEL[r.segment]}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(r.coveredLives)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoneyM(r.premium)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoneyM(r.claims)}</td>
              <td className={`px-3 py-1.5 text-right tabular-nums ${lrClass(r.lossRatio)}`}>{fmtPct(r.lossRatio)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmtUsd(r.premiumPmpm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
