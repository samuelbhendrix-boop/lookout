import Link from "next/link";
import { getSession } from "@/lib/auth";
import { briefing, untrackedCarriers, type BriefItem } from "@/lib/briefing";
import { ActionButton } from "@/components/ActionButton";
import { accountsInPlay } from "@/lib/marketdata/inplay";
import { Importance, TypeBadge, timeAgo } from "@/components/ui";
import { NotIncluded } from "@/components/NotIncluded";
import type { SignalType } from "@prisma/client";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { account_won: "Account won", account_lost: "Account lost", rate_filing: "Rate filing", rate_change: "Negotiated rates", network_add: "Network add", network_drop: "Network drop" };

function Item({ it, rank }: { it: BriefItem; rank?: number }) {
  return (
    <li className="flex gap-3 px-4 py-3">
      {rank != null && <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-sm text-stone-400">{rank}</span>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
          {it.kind ? <span className="rounded bg-stone-900 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide text-white">{KIND_LABEL[it.kind] ?? it.kind}</span> : <TypeBadge type={it.type as SignalType} />}
          <Importance value={it.importance} />
          {it.competitor && <span className="font-medium text-stone-700">{it.competitor}</span>}
          <span>{it.kind ? `detected ${timeAgo(it.when)} ago` : timeAgo(it.when)}</span>
          {it.coverage > 0 && <span>+{it.coverage} outlets</span>}
        </div>
        <Link href={it.href} className="mt-1 block font-medium leading-snug hover:underline">{it.title}</Link>
        <p className="mt-1 text-sm text-stone-600"><span className="font-medium text-stone-800">Why it matters:</span> {it.why}</p>
      </div>
    </li>
  );
}

export default async function BriefingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const days = sp.days === "30" ? 30 : 7;
  const [b, play, untracked] = await Promise.all([briefing(session.workspaceId, days), accountsInPlay(session.workspaceId, { days: 120 }), untrackedCarriers(session.workspaceId)]);
  const hot = play.rows.filter((r) => r.score >= 3);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Briefing</h1>
          <p className="text-sm text-stone-500">
            {b.total ? <>{b.total} new item{b.total === 1 ? "" : "s"} in the last {days} days · {b.major} major · {b.dataDetected} detected from data</> : <>Nothing new in the last {days} days.</>}
          </p>
        </div>
        <div className="flex gap-1.5 text-xs">
          {[7, 30].map((d) => <Link key={d} href={`/briefing?days=${d}`} className={`rounded px-2.5 py-1 ${days === d ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>{d} days</Link>)}
        </div>
      </div>

      <section>
        <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-stone-500">Top {Math.min(5, b.top.length) || "five"}</h2>
        {b.top.length ? <ol className="card divide-y divide-stone-100">{b.top.map((it, i) => <Item key={it.id} it={it} rank={i + 1} />)}</ol>
          : <div className="card px-4 py-8 text-center text-sm text-stone-500">A quiet {days === 7 ? "week" : "month"}. Add sources or competitors, or see everything already on file under <Link className="underline" href="/changes">Changes</Link>.</div>}
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-mono text-xs uppercase tracking-wide text-stone-500">Accounts in play · next 120 days</h2>
          <Link href="/accounts" className="text-xs text-stone-500 hover:text-stone-900">All {play.rows.length} renewing →</Link>
        </div>
        {hot.length ? (
          <ul className="card divide-y divide-stone-100 text-sm">
            {hot.slice(0, 5).map((r) => (
              <li key={`${r.ein}${r.planNum}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
                <span className="min-w-0"><Link href={`/employers?q=${encodeURIComponent(r.sponsor)}`} className="font-medium hover:underline">{r.sponsor}</Link> <span className="text-stone-500">· {r.competitorName ?? r.carrier} · {(r.persons ?? r.participants ?? 0).toLocaleString()} covered · renews {r.renewal.toISOString().slice(0, 10)}</span></span>
                <span className="text-xs text-stone-600">{r.reasons.filter((x) => x.weight > 0).map((x) => x.label).join(" · ")}</span>
              </li>
            ))}
          </ul>
        ) : <div className="card px-4 py-6 text-center text-sm text-stone-500">No competitor-held accounts with strong signals renew in the next 120 days.</div>}
      </section>

      {b.byCompetitor.length > 0 && (
        <section>
          <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-stone-500">By competitor</h2>
          <div className="space-y-3">
            {b.byCompetitor.map((c) => (
              <div key={c.id} className="card">
                <div className="flex items-baseline justify-between border-b border-stone-100 px-4 py-2">
                  <Link href={`/competitors/${c.id}`} className="font-medium hover:underline">{c.name} <span className="ml-1 font-mono text-[10px] text-stone-400">TIER {c.tier}</span></Link>
                  <Link href={`/feed?competitorId=${c.id}`} className="text-xs text-stone-500 hover:text-stone-900">{c.count} new{c.major ? ` · ${c.major} major` : ""} →</Link>
                </div>
                <ul className="divide-y divide-stone-100">{c.items.map((it) => <Item key={it.id} it={it} />)}</ul>
              </div>
            ))}
          </div>

        </section>
      )}

      {b.quiet.length > 0 && (
        <section>
          <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-stone-500">Quiet this {days === 7 ? "week" : "month"} · {b.quiet.length}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {b.quiet.map((c) => (
              <Link key={c.id} href={`/competitors/${c.id}`} className="card flex items-baseline justify-between px-4 py-2.5 text-sm hover:bg-stone-50">
                <span className="font-medium">{c.name} <span className="ml-1 font-mono text-[10px] text-stone-400">TIER {c.tier}</span></span>
                <span className="text-xs text-stone-500">{c.last ? `last activity ${timeAgo(c.last)} ago` : "no signals yet"}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {untracked.length > 0 && (
        <section>
          <h2 className="mb-1 font-mono text-xs uppercase tracking-wide text-stone-500">Carriers in your states you don&apos;t track</h2>
          <p className="mb-2 text-xs text-stone-500">Fully insured covered lives in New England from CMS loss-ratio filings ({untracked[0].year}). Add one to pull its filings, products, rates and news into Lookout.</p>
          <ul className="card divide-y divide-stone-100 text-sm">
            {untracked.map((u) => (
              <li key={u.name} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span><span className="font-medium">{u.name}</span> <span className="text-xs text-stone-500">· {u.lives.toLocaleString()} lives · {u.states.join(", ")}</span></span>
                <ActionButton method="POST" path="/competitors" body={{ name: u.name, tier: 3 }} className="btn-ghost text-xs" doneText="Added">Track</ActionButton>
              </li>
            ))}
          </ul>
        </section>
      )}

      <NotIncluded items={[
        "Ranking is importance (1–5), plus weight for tier-1 competitors, stories several outlets covered, escalated items and changes detected from filings and rate files. It is a sort order, not a judgment.",
        "\"Why it matters\" lines are written by rule from the kind of change; they state the implication to check, not a prediction.",
        "Years of account switches and filings loaded when a dataset is first imported are history, not news — they're on the Changes page, not here.",
        "Archived and auto-filtered signals, and duplicate coverage of the same story.",
        b.noise ? `${b.noise} stock-quote and analyst-rating items this period (still in the Feed).` : null,
      ]} title="How this is built" />
    </div>
  );
}
