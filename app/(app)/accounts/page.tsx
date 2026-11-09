import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { accountsInPlay, brokerLeague } from "@/lib/marketdata/inplay";
import { NotIncluded } from "@/components/NotIncluded";

export const dynamic = "force-dynamic";

const STATES = ["MA", "NH", "RI", "ME", "CT", "VT"];
const money = (n: number | null) => (n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const state = STATES.includes(sp.state ?? "") ? sp.state : undefined;
  const days = [60, 120, 180, 365].includes(Number(sp.days)) ? Number(sp.days) : 120;
  const scope = sp.scope === "all" ? "all" : "competitors";
  const tab = sp.tab === "brokers" ? "brokers" : "accounts";
  const competitors = await db.competitor.findMany({ where: { workspaceId: session.workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const competitorId = competitors.some((c) => c.id === sp.competitor) ? sp.competitor : undefined;
  const qs = (o: Record<string, string | undefined>) => `/accounts?${new URLSearchParams(Object.entries({ state, days: String(days), scope, tab, competitor: competitorId, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const chip = (on: boolean) => `rounded px-2 py-1 ${on ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`;

  const play = tab === "accounts" ? await accountsInPlay(session.workspaceId, { state, days, scope, competitorId }) : null;
  const league = tab === "brokers" ? await brokerLeague(state) : null;
  const shown = play?.rows.slice(0, 300) ?? [];
  const strong = play?.rows.filter((r) => r.score >= 3).length ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Accounts in play</h1>
        <p className="max-w-3xl text-sm text-stone-500">
          Employer groups coming up for renewal, ranked by evidence the account can be won: what the employer&apos;s own filings show (premium per person,
          claims against premium, a new broker) and what its carrier just did (rate increases, lost hospitals). Every reason is listed — hover for the numbers.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Link href={qs({ tab: "accounts" })} className={`rounded-full px-2.5 py-1 ${tab === "accounts" ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>Renewing accounts</Link>
        <Link href={qs({ tab: "brokers" })} className={`rounded-full px-2.5 py-1 ${tab === "brokers" ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>Broker league table</Link>
        <span className="mx-2 text-stone-300">|</span>
        {STATES.map((st) => <Link key={st} href={qs({ state: state === st ? undefined : st })} className={chip(state === st)}>{st}</Link>)}
        {tab === "accounts" && (
          <>
            <span className="mx-2 text-stone-300">|</span>
            {[60, 120, 180, 365].map((d) => <Link key={d} href={qs({ days: String(d) })} className={chip(days === d)}>{d === 365 ? "12 mo" : `${d} days`}</Link>)}
            <span className="mx-2 text-stone-300">|</span>
            <Link href={qs({ scope: scope === "all" ? "competitors" : "all", competitor: undefined })} className={chip(scope === "all")}>All carriers</Link>
          </>
        )}
      </div>
      {tab === "accounts" && scope !== "all" && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-stone-500">Held by:</span>
          <Link href={qs({ competitor: undefined })} className={chip(!competitorId)}>Any competitor</Link>
          {competitors.map((c) => <Link key={c.id} href={qs({ competitor: c.id })} className={chip(competitorId === c.id)}>{c.name}</Link>)}
        </div>
      )}

      {play && (
        <>
          <p className="text-sm text-stone-600">
            <span className="font-medium text-stone-900">{play.rows.length.toLocaleString()}</span> accounts renew in the next {days === 365 ? "12 months" : `${days} days`} ·{" "}
            <span className="font-medium text-stone-900">{strong}</span> with strong signals (score 3+) · <a className="underline" href={`/api/v1/accounts?${new URLSearchParams(Object.entries({ state, days: String(days), scope, competitor: competitorId }).filter(([, v]) => v) as [string, string][])}`}>CSV</a>
          </p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
                <tr><th className="px-3 py-2">Employer</th><th className="px-3 py-2">Renews</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2 text-right">Covered</th><th className="px-3 py-2 text-right">Premium</th><th className="min-w-[300px] px-3 py-2">Why it&apos;s in play</th><th className="px-3 py-2">Broker</th></tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {shown.map((r) => (
                  <tr key={`${r.ein}${r.planNum}`} className="align-top">
                    <td className="max-w-[200px] px-3 py-2">
                      <Link href={`/employers?q=${encodeURIComponent(r.sponsor)}`} className="font-medium hover:underline">{r.sponsor}</Link>
                      <div className="text-xs text-stone-500">{r.city ? `${r.city}, ` : ""}{r.state} · {r.sector}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.renewal.toISOString().slice(0, 10)}<div className="text-xs text-stone-500">{r.daysOut} days · filed {r.filingYear}</div></td>
                    <td className="max-w-[150px] px-3 py-2">{r.competitorId ? <Link className="hover:underline" href={`/competitors/${r.competitorId}`}>{r.competitorName}</Link> : <span className="text-stone-600">{r.carrier}</span>}<div className="text-xs text-stone-500">{r.funding}</div></td>
                    <td className="px-3 py-2 text-right tabular-nums">{(r.persons ?? r.participants ?? 0).toLocaleString()}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(r.premium)}<div className="text-xs text-stone-500">{r.perPerson ? `$${Math.round(r.perPerson).toLocaleString()}/person` : ""}</div></td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.reasons.map((x, i) => (
                          <span key={i} title={x.detail} className={`cursor-help rounded px-1.5 py-0.5 text-[11px] ${x.weight >= 2 ? "bg-emerald-100 text-emerald-900" : x.weight === 1 ? "bg-amber-100 text-amber-900" : x.weight < 0 ? "bg-red-100 text-red-800" : "bg-stone-100 text-stone-600"}`}>{x.label}</span>
                        ))}
                        {!r.reasons.length && <span className="text-xs text-stone-400">renewal only</span>}
                      </div>
                    </td>
                    <td className="max-w-[140px] px-3 py-2 text-xs text-stone-600">{r.brokers.slice(0, 2).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && <p className="px-4 py-8 text-center text-sm text-stone-500">No accounts match. Try a longer window or &quot;All carriers&quot;.</p>}
          </div>
          {play.rows.length > shown.length && <p className="text-xs text-stone-500">Showing the top {shown.length} of {play.rows.length.toLocaleString()}; the CSV has all of them.</p>}
          <NotIncluded items={[
            <>Based on Form 5500 filings, which arrive 7–10 months after a plan year ends: each row says which year it was filed for. An account may already have moved since.</>,
            <>Renewal date is the next anniversary of the policy start in the latest filing — assumed annual.</>,
            <>{play.selfFundedSkipped.toLocaleString()} self-funded plans with no insurance contract on file (no carrier, premium or broker is reported for them) — see Employers for their administrators.</>,
            <>Plans under 100 participants don&apos;t file the full form and aren&apos;t here.</>,
            <>&quot;Filed +N%&quot; is the carrier&apos;s individual/small-group filing in that state — a direction of travel, not the large-group rate. Regulator-reported large-group increases are used where a state publishes them (RI).</>,
            <>Premium-per-person changes are only shown when the same carrier covered a similar number of people both years (within 25%); bigger swings are usually census or partial-year effects and are left out.</>,
            <>Claims figures exist only for experience-rated contracts that report them ({play.rows.filter((r) => r.lossRatio != null).length} of these {play.rows.length}).</>,
            <>&quot;New broker&quot; compares broker names across years after normalising spelling; a firm that was renamed or acquired can still look new — the hover shows both names.</>,
          ]} />
        </>
      )}

      {league && (
        <>
          <p className="text-sm text-stone-600">
            <span className="font-medium text-stone-900">{league.moves}</span> carrier switches between consecutive plan years{state ? ` in ${state}` : " across New England"}, credited to the broker on the new carrier&apos;s contract.
          </p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
                <tr><th className="px-3 py-2">Broker</th><th className="px-3 py-2 text-right">Accounts moved</th><th className="px-3 py-2 text-right">People moved</th><th className="px-3 py-2">Where they moved them</th><th className="px-3 py-2 text-right">Book</th><th className="px-3 py-2">Places most with</th></tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {league.brokers.slice(0, 60).map((b) => (
                  <tr key={b.name} className="align-top">
                    <td className="px-3 py-2 font-medium">{b.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.moves || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.movedPersons ? b.movedPersons.toLocaleString() : "—"}</td>
                    <td className="px-3 py-2 text-xs text-stone-600">{b.flows.map((f) => `${f.flow}${f.n > 1 ? ` ×${f.n}` : ""}`).join("; ") || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{b.accounts}<div className="text-xs text-stone-500">{b.persons.toLocaleString()} people</div></td>
                    <td className="px-3 py-2 text-xs text-stone-600">{b.carriers.map((c) => `${c.carrier} ${c.n}`).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <NotIncluded items={[
            <>Only switches between recognised medical carriers are counted; moves to or from self-funding and to carriers not in the registry are left out.</>,
            <>{league.unattributed} switches had no broker listed on the new contract.</>,
            <>Broker names are free text on Schedule A; offices of the same firm are merged by name, which can also merge unrelated firms that share a distinctive word.</>,
            <>Plan years 2021 onward, employers with 100+ participants.</>,
          ]} />
        </>
      )}
    </div>
  );
}
