import Link from "next/link";
import { getSession, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { CompetitorForm } from "@/components/forms";
import { ActionButton } from "@/components/ActionButton";
import { Empty } from "@/components/ui";
import { StarterPacks } from "@/components/StarterPacks";
import { packsWithStatus } from "@/lib/starter-packs";

export default async function CompetitorsPage() {
  const session = (await getSession())!;
  const since = new Date(Date.now() - 30 * 864e5);
  const [competitors, recent] = await Promise.all([
    db.competitor.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: [{ tier: "asc" }, { name: "asc" }],
      include: { _count: { select: { signals: true, sources: true } } },
    }),
    db.signal.groupBy({
      by: ["competitorId"],
      where: { workspaceId: session.workspaceId, createdAt: { gte: since }, duplicateOfId: null },
      _count: { _all: true },
    }),
  ]);
  const sourceUrls = new Set(
    (await db.source.findMany({ where: { workspaceId: session.workspaceId }, select: { url: true } })).map((s) => s.url ?? ""),
  );
  const last30 = Object.fromEntries(recent.map((r) => [r.competitorId, r._count._all]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Competitors</h1>
        <p className="text-sm text-stone-500">Aliases drive auto-attribution for general market sources. Be generous with them.</p>
      </div>
      {hasRole(session.role, "ANALYST") && (
        <>
          <CompetitorForm />
          <details className="group" open={competitors.length === 0}>
            <summary className="cursor-pointer list-none font-mono text-xs uppercase tracking-wide text-stone-500 hover:text-stone-900">
              <span className="group-open:hidden">▸</span><span className="hidden group-open:inline">▾</span> Starter packs — load a whole market in one click
            </summary>
            <div className="mt-3"><StarterPacks packs={packsWithStatus(sourceUrls)} /></div>
          </details>
        </>
      )}
      {competitors.length === 0 ? (
        <Empty title="No competitors yet">
          Add your own above, or load a starter pack below.
        </Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 text-left font-mono text-[11px] uppercase tracking-wide text-stone-500">
              <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Tier</th><th className="px-4 py-2">Aliases</th><th className="px-4 py-2 text-right">30d</th><th className="px-4 py-2 text-right">All</th><th className="px-4 py-2 text-right">Sources</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {competitors.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5">
                    <Link href={`/feed?competitorId=${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                    {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-stone-400 hover:text-stone-700">↗</a>}
                  </td>
                  <td className="px-4 py-2.5 font-mono">T{c.tier}</td>
                  <td className="px-4 py-2.5 text-xs text-stone-500">{c.aliases.join(", ") || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{last30[c.id] ?? 0}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-stone-500">{c._count.signals}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-stone-500">{c._count.sources}</td>
                  <td className="px-4 py-2.5 text-right">
                    {hasRole(session.role, "ADMIN") && (
                      <ActionButton method="DELETE" path={`/competitors/${c.id}`} confirmText={`Delete ${c.name}? Signals are kept but unattributed.`} className="text-xs text-red-600 hover:underline">Delete</ActionButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
