import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { listSignals, workspaceStats } from "@/lib/queries";
import { signalQuery, SIGNAL_STATUSES, SIGNAL_TYPES } from "@/lib/validators";
import { Empty, Importance, StatusDot, TypeBadge, timeAgo } from "@/components/ui";
import { QuickTriage } from "@/components/QuickTriage";
import { NewSignalForm } from "@/components/NewSignalForm";
import { StarterPacks } from "@/components/StarterPacks";
import { packsWithStatus } from "@/lib/starter-packs";

type SP = Promise<Record<string, string | undefined>>;

export default async function FeedPage({ searchParams }: { searchParams: SP }) {
  const session = (await getSession())!;
  const raw = await searchParams;
  // Invalid params (hand-edited URL) fall back to defaults rather than erroring.
  const parsed = signalQuery.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v)));
  const filters = parsed.success ? parsed.data : signalQuery.parse({});

  const [{ items, nextCursor }, stats, competitors] = await Promise.all([
    listSignals(session.workspaceId, filters),
    workspaceStats(session.workspaceId),
    db.competitor.findMany({ where: { workspaceId: session.workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const canEdit = session.role !== "VIEWER";
  const qs = (extra: Record<string, string>) =>
    "?" + new URLSearchParams({ ...(Object.fromEntries(Object.entries(raw).filter(([, v]) => v)) as Record<string, string>), ...extra });

  const exportQs = new URLSearchParams(
    Object.entries(raw).filter(([k, v]) => v && k !== "cursor" && k !== "limit") as [string, string][],
  ).toString();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Signal feed</h1>
          <p className="text-sm text-stone-500">One row per story, newest first.</p>
        </div>
        <div className="flex shrink-0 gap-2 whitespace-nowrap">
          <a className="btn-ghost" href={`/api/v1/signals/export?${exportQs}`}>Export CSV</a>
          {canEdit && <NewSignalForm competitors={competitors} />}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Untriaged" value={stats.newCount} href="/feed?status=NEW" accent />
        <Stat label="Escalated" value={stats.escalated} href="/feed?status=ESCALATED" />
        <Stat label="Last 7 days" value={stats.week} />
        <Stat label="Failing sources" value={stats.failingSources} href="/sources" warn={stats.failingSources > 0} />
      </div>

      {stats.topCompetitors.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
          <span className="font-mono uppercase tracking-wide">Most active 7d:</span>
          {stats.topCompetitors.map((c) => (
            <Link key={c.id} href={`/feed?competitorId=${c.id}`} className="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-stone-700 hover:border-stone-400">
              {c.name} <span className="font-mono text-stone-400">{c.count}</span>
            </Link>
          ))}
        </div>
      )}

      <form className="card grid grid-cols-2 gap-2 p-3 sm:grid-cols-6" method="GET">
        <input className="input col-span-2" name="q" placeholder="Search title & summary" defaultValue={filters.q} />
        <select className="input" name="competitorId" defaultValue={filters.competitorId ?? ""}>
          <option value="">All competitors</option>
          {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input" name="type" defaultValue={filters.type ?? ""}>
          <option value="">All types</option>
          {SIGNAL_TYPES.map((t) => <option key={t} value={t}>{t === "M_AND_A" ? "M&A" : t.toLowerCase()}</option>)}
        </select>
        <select className="input" name="status" defaultValue={filters.status ?? ""}>
          <option value="">Active</option>
          {SIGNAL_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
        </select>
        <div className="flex gap-2">
          <select className="input" name="minImportance" defaultValue={filters.minImportance?.toString() ?? ""}>
            <option value="">Any</option>
            {[2, 3, 4, 5].map((n) => <option key={n} value={n}>≥{n}</option>)}
          </select>
          <button className="btn">Go</button>
        </div>
      </form>

      {items.length === 0 ? (
        <Empty title="No signals match">
          {competitors.length === 0 ? (
            <div className="mt-3 flex flex-col items-center gap-3">
              <p>Pick a starter pack — each adds the carriers in that market, their news feeds, and regulator news. Load as many as you like.</p>
              {canEdit && <div className="w-full max-w-2xl"><StarterPacks packs={packsWithStatus(new Set())} /></div>}
              <p className="text-xs">
                Or add your own <Link className="underline" href="/competitors">competitors</Link> and <Link className="underline" href="/sources">sources</Link>.
              </p>
            </div>
          ) : "Loosen the filters, or wait a few minutes for new sources to be polled."}
        </Empty>
      ) : (
        <ul className="card divide-y divide-stone-100">
          {items.map((s) => (
            <li key={s.id} className="group flex items-start gap-3 px-4 py-3">
              <div className="pt-1.5"><StatusDot status={s.status} /></div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  <TypeBadge type={s.type} />
                  {s.competitor && (
                    <Link href={`/feed?competitorId=${s.competitor.id}`} className="font-medium text-stone-800 hover:underline">{s.competitor.name}</Link>
                  )}
                  <span>{s.source?.name ?? "manual"}</span>
                  <span className="font-mono">{timeAgo(s.publishedAt ?? s.createdAt)}</span>
                  {s._count.coverage > 0 && (
                    <span className="rounded bg-stone-100 px-1.5 font-medium text-stone-700" title="Other outlets covering this story">
                      +{s._count.coverage} {s._count.coverage === 1 ? "outlet" : "outlets"}
                    </span>
                  )}
                  {s.duplicateOfId && <span className="italic">also-ran coverage</span>}
                  {s._count.comments > 0 && <span>💬 {s._count.comments}</span>}
                </div>
                <Link href={`/signals/${s.id}`} className="font-medium leading-snug hover:underline">{s.title}</Link>
                {s.summary && <p className="mt-0.5 line-clamp-2 text-sm text-stone-500">{s.summary}</p>}
                {s.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.tags.map(({ tag }) => (
                      <Link key={tag.id} href={`/feed?tag=${encodeURIComponent(tag.name)}`} className="font-mono text-[11px] text-stone-500 hover:text-stone-900">#{tag.name}</Link>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <Importance value={s.importance} />
                {canEdit && <QuickTriage id={s.id} status={s.status} />}
              </div>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <div className="text-center">
          <Link className="btn-ghost" href={qs({ cursor: nextCursor })}>Older →</Link>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, href, accent, warn }: { label: string; value: number; href?: string; accent?: boolean; warn?: boolean }) {
  const inner = (
    <div className={`card px-4 py-3 ${href ? "hover:border-stone-400" : ""}`}>
      <p className="font-mono text-[11px] uppercase tracking-wide text-stone-500">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${warn ? "text-red-600" : accent && value > 0 ? "text-accent" : ""}`}>{value}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
