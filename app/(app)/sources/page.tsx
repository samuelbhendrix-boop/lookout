import { getSession, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { SourceForm } from "@/components/forms";
import { ActionButton } from "@/components/ActionButton";
import { Empty, timeAgo } from "@/components/ui";

export default async function SourcesPage() {
  const session = (await getSession())!;
  const [sources, competitors] = await Promise.all([
    db.source.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: { createdAt: "desc" },
      include: { competitor: { select: { name: true } }, _count: { select: { signals: true } } },
    }),
    db.competitor.findMany({ where: { workspaceId: session.workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const canEdit = hasRole(session.role, "ANALYST");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Sources</h1>
        <p className="text-sm text-stone-500">
          RSS/Atom feeds polled by the worker. Newsrooms, Google News queries, regulator feeds, trade press.
        </p>
      </div>
      {canEdit && <SourceForm competitors={competitors} />}
      {canEdit && sources.some((s) => s.enabled && s.lastError) && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-red-200 bg-red-50 px-4 py-3 text-sm">
          <span>
            {sources.filter((s) => s.enabled && s.lastError).length} sources failed their last poll. Busy news providers
            (HTTP 503/429) usually clear on retry.
          </span>
          <ActionButton method="POST" path="/sources/retry-failed" doneText="Queued — refresh in a few minutes" className="btn-ghost">
            Retry failed sources
          </ActionButton>
        </div>
      )}
      {sources.length === 0 ? (
        <Empty title="No sources yet">
          Tip: a Google News RSS query like <code className="font-mono text-xs">news.google.com/rss/search?q=&quot;Acme Health&quot;</code> is a fast first source.
        </Empty>
      ) : (
        <ul className="card divide-y divide-stone-100">
          {sources.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className={`h-2 w-2 shrink-0 rounded-full ${!s.enabled ? "bg-stone-300" : s.lastError ? "bg-red-600" : s.lastPolledAt ? "bg-emerald-500" : "bg-amber-400"}`} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.name} <span className="text-xs font-normal text-stone-500">· {s.competitor?.name ?? "general"}</span></p>
                <p className="truncate font-mono text-xs text-stone-400">{s.url}</p>
                {s.lastError && <p className="mt-0.5 truncate text-xs text-red-600">{s.lastError}</p>}
              </div>
              <div className="text-right font-mono text-xs text-stone-500">
                <p>{s._count.signals} signals</p>
                <p>{s.lastPolledAt ? `polled ${timeAgo(s.lastPolledAt)} ago` : "never polled"} · every {s.pollMinutes}m</p>
              </div>
              {canEdit && (
                <div className="flex gap-3">
                  <ActionButton method="POST" path={`/sources/${s.id}/poll`} doneText="Queued">Poll now</ActionButton>
                  <ActionButton method="PATCH" path={`/sources/${s.id}`} body={{ enabled: !s.enabled }}>{s.enabled ? "Pause" : "Resume"}</ActionButton>
                  {hasRole(session.role, "ADMIN") && (
                    <ActionButton method="DELETE" path={`/sources/${s.id}`} confirmText="Delete source? Its signals are kept." className="text-xs text-red-600 hover:underline">Delete</ActionButton>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
