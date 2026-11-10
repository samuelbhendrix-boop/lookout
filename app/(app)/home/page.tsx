import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { briefing, type BriefItem } from "@/lib/briefing";
import { accountsInPlay } from "@/lib/marketdata/inplay";
import { AUTO_FILTER_TAG } from "@/lib/relevance";
import { Importance, TypeBadge, timeAgo } from "@/components/ui";
import type { SignalType } from "@prisma/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

const KIND_LABEL: Record<string, string> = { account_won: "Account won", account_lost: "Account lost", rate_filing: "Rate filing", rate_change: "Negotiated rates", network_add: "Network add", network_drop: "Network drop" };
const KIND_TONE: Record<string, string> = { account_won: "bg-emerald-600", account_lost: "bg-red-600", network_drop: "bg-red-600", network_add: "bg-emerald-600", rate_filing: "bg-ink", rate_change: "bg-ink" };
const DAY = 864e5;

/** Best-ranked first, at most `per` from any one competitor, so one busy carrier can't fill the list. */
function spread<T extends { competitorId: string | null }>(xs: T[], n: number, per = 2) {
  const seen = new Map<string, number>();
  const out: T[] = [];
  for (const x of xs) {
    const k = x.competitorId ?? "_";
    if ((seen.get(k) ?? 0) >= per) continue;
    seen.set(k, (seen.get(k) ?? 0) + 1);
    out.push(x);
    if (out.length === n) break;
  }
  // Too few other competitors to fill the list: top it up with the next best.
  for (const x of xs) { if (out.length >= Math.min(n, 4)) break; if (!out.includes(x)) out.push(x); }
  return out;
}

function greeting(now = new Date()) {
  const h = Number(now.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Kpi({ label, value, sub, href, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string; tone?: "up" | "down" | "warn" }) {
  const body = (
    <>
      <p className="font-mono text-[10px] uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {sub && <p className={`mt-0.5 text-xs ${tone === "up" ? "text-emerald-700" : tone === "down" ? "text-red-600" : tone === "warn" ? "text-amber-700" : "text-stone-500"}`}>{sub}</p>}
    </>
  );
  return href ? <Link href={href} className="card block p-4 hover:border-stone-300 hover:bg-stone-50">{body}</Link> : <div className="card p-4">{body}</div>;
}

function Row({ it }: { it: BriefItem }) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
        {it.kind ? <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide text-white ${KIND_TONE[it.kind] ?? "bg-ink"}`}>{KIND_LABEL[it.kind] ?? it.kind}</span> : <TypeBadge type={it.type as SignalType} />}
        <Importance value={it.importance} />
        {it.competitor && <span className="font-medium text-stone-700">{it.competitor}</span>}
        <span>{timeAgo(it.when)} ago</span>
        {it.coverage > 0 && <span>· {it.coverage + 1} outlets</span>}
      </div>
      <Link href={it.href} className="mt-1 block font-medium leading-snug hover:underline">{it.title}</Link>
      <p className="mt-0.5 line-clamp-2 text-sm text-stone-600">{it.why}</p>
    </li>
  );
}

function Panel({ title, href, cta, children }: { title: string; href?: string; cta?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-mono text-xs uppercase tracking-wide text-stone-500">{title}</h2>
        {href && <Link href={href} className="text-xs text-stone-500 hover:text-stone-900">{cta ?? "All"} →</Link>}
      </div>
      {children}
    </section>
  );
}

export default async function HomePage() {
  const session = (await getSession())!;
  const ws = session.workspaceId;
  const now = Date.now();
  const live = { workspaceId: ws, duplicateOfId: null, status: { not: "ARCHIVED" as const }, NOT: { tags: { some: { tag: { name: AUTO_FILTER_TAG } } } } };
  const [b, play, thisWeek, lastWeek, daily, sources, competitors, imports] = await Promise.all([
    briefing(ws, 30),
    accountsInPlay(ws, { days: 90 }),
    db.signal.count({ where: { ...live, createdAt: { gte: new Date(now - 7 * DAY) } } }),
    db.signal.count({ where: { ...live, createdAt: { gte: new Date(now - 14 * DAY), lt: new Date(now - 7 * DAY) } } }),
    db.$queryRaw<Array<{ d: Date; n: bigint }>>`
      SELECT date_trunc('day', s."createdAt") AS d, count(*) AS n FROM "Signal" s
      WHERE s."workspaceId" = ${ws} AND s."duplicateOfId" IS NULL AND s.status <> 'ARCHIVED' AND s."createdAt" >= now() - interval '30 days'
      GROUP BY 1 ORDER BY 1`,
    db.source.findMany({ where: { workspaceId: ws, enabled: true }, select: { lastError: true, lastPolledAt: true } }),
    db.competitor.count({ where: { workspaceId: ws } }),
    db.dataImport.findMany({ select: { status: true, finishedAt: true } }),
  ]);

  const week = new Date(now - 7 * DAY);
  const movers = spread(b.items.filter((i) => i.kind), 6);
  const allNews = b.items.filter((i) => !i.kind);
  const recentNews = allNews.filter((i) => i.when >= week);
  const stories = spread(recentNews.length >= 3 ? recentNews : allNews, 6);
  const hot = play.rows.filter((r) => r.score >= 3);
  const hotLives = hot.reduce((s, r) => s + (r.persons ?? r.participants ?? 0), 0);
  const delta = lastWeek ? (thisWeek - lastWeek) / lastWeek : null;
  const failing = sources.filter((s) => s.lastError).length;
  const lastImport = imports.map((i) => i.finishedAt?.getTime() ?? 0).filter((t) => t > 0).sort((a, c) => c - a)[0];
  const failedImports = imports.filter((i) => i.status === "failed").length;

  // 30-day activity strip.
  const counts = new Map(daily.map((r) => [new Date(r.d).toISOString().slice(0, 10), Number(r.n)]));
  const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(now - (29 - i) * DAY).toISOString().slice(0, 10); return { d, n: counts.get(d) ?? 0 }; });
  const peak = Math.max(1, ...days.map((x) => x.n));
  const active = b.byCompetitor.slice().sort((a, c) => c.count - a.count).slice(0, 6);
  const activePeak = Math.max(1, ...active.map((c) => c.count));
  const first = (session.name ?? "").split(" ")[0];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting()}{first ? `, ${first}` : ""}.</h1>
          <p className="text-sm text-stone-500">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" })} ·{" "}
            {b.total ? <>{b.total} things moved in the last 30 days{b.major ? `, ${b.major} of them major` : ""}.</> : <>Nothing new in the last 30 days.</>}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/briefing" className="btn-ghost">Full briefing</Link>
          <Link href="/changes" className="btn-ghost">All market changes</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label="News this week" value={thisWeek.toLocaleString()} href="/feed" sub={delta == null ? "no prior week" : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(delta * 100))}% vs last week`} tone={delta == null ? undefined : delta >= 0 ? "up" : "down"} />
        <Kpi label="Major items · 30d" value={b.major} href="/briefing?days=30" sub="importance 4–5" />
        <Kpi label="Detected from data · 30d" value={b.dataDetected} href="/changes" sub="filings, rates, networks, accounts" />
        <Kpi label="Accounts in play · 90d" value={hot.length} href="/accounts" sub={hot.length ? `${hotLives.toLocaleString()} covered lives` : "none with strong signals"} />
        <Kpi label="Competitors tracked" value={competitors} href="/competitors" sub={b.quiet.length ? `${b.quiet.length} quiet this month` : "all active this month"} />
        <Kpi label="Sources" value={`${sources.length - failing}/${sources.length}`} href="/sources" sub={failing ? `${failing} failing` : lastImport ? `market data ${timeAgo(new Date(lastImport))} old${failedImports ? ` · ${failedImports} import failed` : ""}` : "healthy"} tone={failing || failedImports ? "warn" : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Top things that moved" href="/changes" cta="All changes">
          {movers.length ? <ul className="card divide-y divide-stone-100">{movers.map((it) => <Row key={it.id} it={it} />)}</ul>
            : <div className="card px-4 py-8 text-center text-sm text-stone-500">No rate, network or account changes detected for your competitors in the last 30 days.</div>}
        </Panel>
        <Panel title={recentNews.length >= 3 ? "Top stories this week" : "Top stories · 30 days"} href="/feed" cta="Feed">
          {stories.length ? <ul className="card divide-y divide-stone-100">{stories.map((it) => <Row key={it.id} it={it} />)}</ul>
            : <div className="card px-4 py-8 text-center text-sm text-stone-500">No news yet. <Link href="/sources" className="underline">Add sources</Link>.</div>}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Activity · 30 days">
          <div className="card p-4">
            <div className="flex h-24 items-end gap-[3px]" aria-label="News items per day, last 30 days">
              {days.map((x) => <div key={x.d} title={`${x.d}: ${x.n}`} className={`flex-1 rounded-sm ${x.n ? "bg-accent" : "bg-stone-100"}`} style={{ height: `${Math.max(4, (x.n / peak) * 100)}%` }} />)}
            </div>
            <div className="mt-1 flex justify-between font-mono text-[10px] text-stone-400"><span>{days[0].d.slice(5)}</span><span>today</span></div>
          </div>
        </Panel>
        <Panel title="Most active competitors · 30d" href="/competitors" cta="All">
          <div className="card space-y-2 p-4">
            {active.length ? active.map((c) => (
              <Link key={c.id} href={`/competitors/${c.id}`} className="block text-sm hover:underline">
                <div className="flex justify-between"><span className="truncate">{c.name}</span><span className="tabular-nums text-stone-500">{c.count}{c.major ? <span className="text-red-600"> · {c.major} major</span> : null}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-stone-100"><div className="h-1.5 rounded-full bg-ink" style={{ width: `${(c.count / activePeak) * 100}%` }} /></div>
              </Link>
            )) : <p className="text-sm text-stone-500">No competitor activity yet.</p>}
          </div>
        </Panel>
        <Panel title="Renewing soon · in play" href="/accounts" cta="Accounts">
          {hot.length ? (
            <ul className="card divide-y divide-stone-100 text-sm">
              {hot.slice(0, 5).map((r) => (
                <li key={`${r.ein}${r.planNum}`} className="px-4 py-2.5">
                  <Link href={`/employers?q=${encodeURIComponent(r.sponsor)}`} className="font-medium hover:underline">{r.sponsor}</Link>
                  <p className="text-xs text-stone-500">{r.competitorName ?? r.carrier} · {(r.persons ?? r.participants ?? 0).toLocaleString()} covered · {r.daysOut} days</p>
                </li>
              ))}
            </ul>
          ) : <div className="card px-4 py-6 text-center text-sm text-stone-500">No competitor-held accounts with strong signals renew in the next 90 days.</div>}
        </Panel>
      </div>
    </div>
  );
}
