import Link from "next/link";
import { CompanyLogo } from "@/components/CompanyLogo";
import { ActionButton } from "@/components/ActionButton";
import { NotIncluded } from "@/components/NotIncluded";
import { notFound } from "next/navigation";
import type { Segment } from "@prisma/client";
import { getSession, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { competitorProfile, type SegmentYear } from "@/lib/marketdata/queries";
import { Sparkline, fmtInt, fmtMoneyM, fmtPct, fmtSignedPct, fmtUsd, lrClass, deltaClass, SEGMENT_LABEL } from "@/components/charts";
import { Empty, Importance, TypeBadge, timeAgo } from "@/components/ui";
import { IssuerPatternEditor } from "@/components/IssuerPatternEditor";
import { competitorLargeGroup } from "@/lib/marketdata/largegroup";
import { CompetitorLargeGroup } from "@/components/LargeGroup";
import { competitorEmployers, transparencyPlanCatalog } from "@/lib/marketdata/employers";
import { carrierIndex } from "@/lib/marketdata/mrf/queries";
import { issuerPatternFor } from "@/lib/marketdata/queries";
import { EmployerBook } from "@/components/EmployerBook";

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

  const [profile, allStates, signals, importsDone, largeGroup, employers, catalog] = await Promise.all([
    competitorProfile(comp, state),
    state ? competitorProfile(comp).then((p) => p.states) : null,
    db.signal.findMany({
      where: { workspaceId: session.workspaceId, competitorId: comp.id, duplicateOfId: null, status: { not: "ARCHIVED" } },
      orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      take: 6,
    }),
    db.dataImport.count({ where: { status: "done" } }),
    competitorLargeGroup(comp, state),
    competitorEmployers(session.workspaceId, comp.id, state),
    transparencyPlanCatalog(comp),
  ]);
  let changes: Array<{ id: string; kind: string; title: string; summary: string; url: string | null; occurredAt: Date; importance: number }> = [];
  try {
    changes = await db.$queryRaw`SELECT id, kind, title, summary, url, "occurredAt", importance FROM "MarketEvent" WHERE carrier ~* ${issuerPatternFor(comp)} ORDER BY "occurredAt" DESC, importance DESC LIMIT 8`;
  } catch {
    changes = [];
  }
  let pricing: Awaited<ReturnType<typeof carrierIndex>>[number] | undefined;
  try {
    const re = new RegExp(issuerPatternFor(comp), "i");
    pricing = (await carrierIndex()).find((x) => re.test(x.carrierName));
  } catch {
    pricing = undefined;
  }
  const lgStates = [...largeGroup.enrollment.map((e) => e.state), ...largeGroup.financials.map((f) => f.state), ...largeGroup.rateActions.map((a) => a.state)];
  const states = [...new Set([...(allStates ?? profile.states), ...(state ? [] : lgStates)])].sort();
  const years = [...new Set(profile.performance.map((p) => p.year))].sort();
  const latestYear = years[years.length - 1];
  const get = (seg: Segment, y: number) => profile.performance.find((p) => p.segment === seg && p.year === y);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/competitors" className="text-sm text-stone-500 hover:text-stone-900">← Competitors</Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight"><CompanyLogo id={comp.id} name={comp.name} size={32} />{comp.name}</h1>
            <p className="text-sm text-stone-500">
              Tier {comp.tier}
              {comp.website && <> · <a className="underline" href={comp.website} target="_blank" rel="noopener noreferrer">website</a></>}
              {" · "}<Link className="underline" href={`/competitors/${comp.id}/products${state ? `?state=${state}` : ""}`}>commercial products</Link>
              {" · "}<Link className="underline" href={`/updates?competitorId=${comp.id}`}>all signals</Link>
            </p>
            <p className="mt-1 text-xs text-stone-500">
              News: {comp.newsScope === "region" ? "New England only (plus its national exchange, employer and ICHRA moves)" : "everything that names it"}{" "}
              <ActionButton method="PATCH" path={`/competitors/${comp.id}`} body={{ newsScope: comp.newsScope === "region" ? "all" : "region" }} className="underline hover:text-stone-900" doneText="Updated">
                {comp.newsScope === "region" ? "Show all its news" : "Limit to New England"}
              </ActionButton>
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

      {/* ── Large group (state sources, incl. self-insured) ── */}
      <CompetitorLargeGroup data={largeGroup} serffStates={(state ? [state] : states).filter((s) => ["MA", "NH", "ME", "RI", "CT", "VT"].includes(s))} />

      <EmployerBook data={employers} competitorId={comp.id} state={state} />

      {changes.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Recent market changes</h2>
            <Link href={`/updates?view=market&days=365&competitorId=${comp.id}`} className="text-xs underline">All changes →</Link>
          </div>
          <div className="card divide-y divide-stone-100">
            {changes.map((e) => (
              <div key={e.id} className="px-4 py-2 text-sm">
                <span className="mr-2 text-xs text-stone-400">{e.occurredAt.toISOString().slice(0, 10)}</span>
                {e.url ? <Link href={e.url} className="hover:underline">{e.title}</Link> : e.title}
                {e.importance >= 4 && <span className="ml-1.5 text-[10px] font-semibold text-red-700">MAJOR</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {pricing && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">Price position · negotiated rates</h2>
          <div className="card flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
            <div>
              <p className={`text-3xl font-semibold tabular-nums ${pricing.index == null ? "text-stone-400" : pricing.index >= 1.05 ? "text-red-700" : pricing.index <= 0.95 ? "text-emerald-700" : ""}`}>
                {pricing.index == null ? "—" : `${pricing.index >= 1 ? "+" : "−"}${Math.abs((pricing.index - 1) * 100).toFixed(0)}%`}
              </p>
              <p className="text-xs text-stone-500">vs peers, same service at the same provider</p>
              {pricing.pctMedicare != null && <p className="mt-1 text-sm"><span className="font-medium">{Math.round(pricing.pctMedicare * 100)}%</span> <span className="text-xs text-stone-500">of Medicare (median)</span></p>}
            </div>
            <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-3">
              {pricing.byCategory.map((b) => (
                <div key={b.category} className="flex justify-between">
                  <span className="text-stone-600">{b.category}</span>
                  <span className="tabular-nums">{b.index == null ? "—" : `${b.index >= 1 ? "+" : "−"}${Math.abs((b.index - 1) * 100).toFixed(0)}%`}{b.pctMedicare != null ? <span className="text-stone-400"> · {Math.round(b.pctMedicare * 100)}% M</span> : null}</span>
                </div>
              ))}
            </div>
            <Link href="/rates" className="text-xs underline">Provider-level rates →</Link>
          </div>
          <p className="text-xs text-stone-500">From {pricing.carrierName}&apos;s federally required rate files: {pricing.comparisons.toLocaleString()} service × provider comparisons at {pricing.providers} providers also priced by another carrier. &quot;M&quot; = median % of Medicare. <Link className="underline" href="/rates#not-included">What&apos;s not included</Link></p>
        </section>
      )}

      {catalog.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">Plan catalog · transparency index</h2>
          <p className="text-xs text-stone-500">Every plan this carrier lists in its Transparency in Coverage table of contents — the only public list that includes large-group products. <Link className="underline" href="/transparency">About these files</Link></p>
          <details className="card">
            <summary className="cursor-pointer px-4 py-2 text-sm">
              {catalog.filter((p) => p.marketType === "group").length} group plans · {catalog.filter((p) => p.marketType === "individual").length} individual plans
            </summary>
            <ul className="grid gap-x-6 gap-y-0.5 border-t border-stone-100 px-4 py-3 text-xs text-stone-700 sm:grid-cols-2">
              {catalog.map((p) => (
                <li key={`${p.marketType}${p.planName}${p.sponsorName}`} className="truncate" title={p.planName}>
                  <span className="mr-1 font-mono text-[10px] text-stone-400">{p.marketType === "group" ? "GRP" : "IND"}</span>{p.planName}
                </li>
              ))}
            </ul>
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
          <Link href={`/competitors/${comp.id}/products${state ? `?state=${state}` : ""}`} className="inline-block text-sm font-medium underline">Plan designs, pricing position, benefits and year-over-year changes →</Link>
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
                    <td className="whitespace-nowrap px-3 py-2">{p.state} {p.state === "MA" ? "Merged" : p.market}</td>
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
                      <td className="whitespace-nowrap px-3 py-2">{f.state} {f.state === "MA" ? "Merged" : f.market}</td>
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
      <NotIncluded items={[
        "Products and rate filings cover ACA individual and small group only; large-group products aren't publicly filed (the plan catalog above, where shown, comes from the carrier's own transparency index).",
        "Employer book: Form 5500 filers with 100+ participants only — government, church and small employers are missing, and self-funded clients appear only where the carrier is named on Schedule A or lists the EIN in its transparency index.",
        <>Price position: only services at providers also priced by another carrier; see <Link className="underline" href="/rates#not-included">Rates → What&apos;s not included</Link>.</>,
        "Financials: fully insured business only (CMS MLR); self-funded revenue (ASO fees) isn't reported publicly.",
      ]} />
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
