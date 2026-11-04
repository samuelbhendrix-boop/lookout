import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { Importance, StatusDot, TypeBadge, timeAgo } from "@/components/ui";
import { SignalEditor } from "@/components/SignalEditor";
import { CommentForm } from "@/components/CommentForm";
import { ActionButton } from "@/components/ActionButton";

export default async function SignalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await getSession())!;
  const signal = await db.signal.findFirst({
    where: { id, workspaceId: session.workspaceId },
    include: {
      competitor: true,
      source: true,
      tags: { include: { tag: true } },
      duplicateOf: { select: { id: true, title: true } },
      coverage: { orderBy: { createdAt: "asc" }, select: { id: true, title: true, url: true, source: { select: { name: true } } } },
      comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, email: true } } } },
    },
  });
  if (!signal) notFound();
  const competitors = await db.competitor.findMany({
    where: { workspaceId: session.workspaceId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const canEdit = session.role !== "VIEWER";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <article className="space-y-5">
        <Link href="/feed" className="text-sm text-stone-500 hover:text-stone-900">← Feed</Link>
        {signal.duplicateOf && (
          <div className="card flex flex-wrap items-center justify-between gap-2 border-amber-200 bg-amber-50 px-4 py-2 text-sm">
            <span>
              Grouped under story:{" "}
              <Link href={`/signals/${signal.duplicateOf.id}`} className="font-medium underline">{signal.duplicateOf.title}</Link>
            </span>
            {canEdit && (
              <ActionButton method="PATCH" path={`/signals/${signal.id}`} body={{ duplicateOfId: null }} className="btn-ghost">
                Not the same story — split out
              </ActionButton>
            )}
          </div>
        )}
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
            <StatusDot status={signal.status} />
            <span className="font-mono">{signal.status.toLowerCase()}</span>
            <TypeBadge type={signal.type} />
            <Importance value={signal.importance} />
          </div>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">{signal.title}</h1>
          <p className="mt-2 text-sm text-stone-500">
            {signal.competitor?.name ?? "Unattributed"} · {signal.source?.name ?? "Logged manually"} ·{" "}
            {(signal.publishedAt ?? signal.createdAt).toLocaleString()}
          </p>
          {signal.url && (
            <a href={signal.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block break-all text-sm text-accent underline">
              {signal.url}
            </a>
          )}
        </div>
        {signal.summary && <p className="whitespace-pre-wrap leading-relaxed text-stone-700">{signal.summary}</p>}

        {signal.coverage.length > 0 && (
          <section>
            <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-stone-500">
              Also covered by {signal.coverage.length} {signal.coverage.length === 1 ? "outlet" : "outlets"}
            </h2>
            <ul className="card divide-y divide-stone-100 text-sm">
              {signal.coverage.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <Link href={`/signals/${c.id}`} className="min-w-0 truncate hover:underline">{c.title}</Link>
                  <span className="shrink-0 text-xs text-stone-500">{c.source?.name ?? "manual"}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-stone-500">Discussion ({signal.comments.length})</h2>
          <ul className="space-y-3">
            {signal.comments.map((c) => (
              <li key={c.id} className="card px-4 py-3">
                <p className="mb-1 text-xs text-stone-500">
                  <span className="font-medium text-stone-800">{c.author.name ?? c.author.email}</span> · {timeAgo(c.createdAt)}
                </p>
                <p className="whitespace-pre-wrap text-sm">{c.body}</p>
              </li>
            ))}
          </ul>
          {canEdit && <CommentForm signalId={signal.id} />}
        </section>
      </article>

      <aside>
        {canEdit ? (
          <SignalEditor
            signal={{
              id: signal.id,
              status: signal.status,
              type: signal.type,
              importance: signal.importance,
              competitorId: signal.competitorId,
              tags: signal.tags.map((t) => t.tag.name),
            }}
            competitors={competitors}
            canDelete={session.role === "ADMIN" || session.role === "OWNER"}
          />
        ) : (
          <div className="card p-4 text-sm text-stone-500">Read-only access.</div>
        )}
      </aside>
    </div>
  );
}
