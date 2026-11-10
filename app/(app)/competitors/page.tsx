import Link from "next/link";
import { getSession, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { CompetitorForm } from "@/components/forms";
import { ActionButton } from "@/components/ActionButton";
import { Empty } from "@/components/ui";
import { StarterPacks } from "@/components/StarterPacks";
import { packsWithStatus } from "@/lib/starter-packs";
import { untrackedCarriers } from "@/lib/briefing";
import { Footprint } from "@/components/Footprint";

export const dynamic = "force-dynamic";

export default async function CompetitorsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const since = new Date(Date.now() - 30 * 864e5);
  const ws = await db.workspace.findUnique({ where: { id: session.workspaceId }, select: { ownCompetitorId: true } });
  const usId = ws?.ownCompetitorId ?? null;
  const [competitors, recent, untracked] = await Promise.all([
    db.competitor.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: [{ tier: "asc" }, { name: "asc" }],
      include: { _count: { select: { signals: true, sources: true } } },
    }),
    db.signal.groupBy({
      by: ["competitorId"],
      where: { workspaceId: session.workspaceId, publishedAt: { gte: since }, duplicateOfId: null, status: { not: "ARCHIVED" } },
      _count: { _all: true },
    }),
    untrackedCarriers(session.workspaceId),
  ]);
  const sourceUrls = new Set(
    (await db.source.findMany({ where: { workspaceId: session.workspaceId }, select: { url: true } })).map((s) => s.url ?? ""),
  );
  const last30 = Object.fromEntries(recent.map((r) => [r.competitorId, r._count._all]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Competitors</h1>
        <p className="text-sm text-stone-500">Where each competitor sells and how big it is, then the list you manage below. Aliases drive auto-attribution for general market sources; be generous with them.</p>
      </div>
      {competitors.length > 0 && !competitors.some((c) => c.id === usId) && (
        <div className="card flex flex-wrap items-center justify-between gap-2 border-amber-200 bg-amber-50 p-3 text-sm">
          <span><span className="font-medium">Which one is your company?</span> Mark it with &quot;This is us&quot; in the list below and every page compares against it: share, members, pricing, products. Not listed? Add it as a competitor first.</span>
        </div>
      )}
      {competitors.length > 0 && <Footprint workspaceId={session.workspaceId} seg={sp.seg} />}
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
                    <Link href={`/competitors/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                    {c.id === usId && <span className="ml-2 rounded bg-stone-900 px-1.5 py-0.5 text-[10px] font-medium text-white">Us</span>}
                    {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-stone-400 hover:text-stone-700">↗</a>}
                  </td>
                  <td className="px-4 py-2.5 font-mono">T{c.tier}</td>
                  <td className="px-4 py-2.5 text-xs text-stone-500">{c.aliases.join(", ") || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{last30[c.id] ?? 0}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-stone-500">{c._count.signals}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-stone-500">{c._count.sources}</td>
                  <td className="px-4 py-2.5 text-right">
                    {hasRole(session.role, "ADMIN") && (c.id === usId
                      ? <ActionButton method="PATCH" path="/workspace" body={{ ownCompetitorId: null }} className="mr-3 text-xs text-stone-500 hover:underline" doneText="Cleared">Not us</ActionButton>
                      : <ActionButton method="PATCH" path="/workspace" body={{ ownCompetitorId: c.id }} className="mr-3 text-xs text-stone-700 hover:underline" doneText="Set">This is us</ActionButton>)}
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
      {untracked.length > 0 && (
        <section>
          <h2 className="mb-1 font-mono text-xs uppercase tracking-wide text-stone-500">Carriers in your states you don&apos;t track</h2>
          <p className="mb-2 text-xs text-stone-500">Fully insured covered lives in New England from CMS loss-ratio filings ({untracked[0].year}). Add one to pull its filings, products, rates and news into Payersight.</p>
          <ul className="card divide-y divide-stone-100 text-sm">
            {untracked.map((u) => (
              <li key={u.name} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span><span className="font-medium">{u.name}</span> <span className="text-xs text-stone-500">· {u.lives.toLocaleString()} lives · {u.states.join(", ")}</span></span>
                {hasRole(session.role, "ANALYST") && <ActionButton method="POST" path="/competitors" body={{ name: u.name, tier: 3 }} className="btn-ghost text-xs" doneText="Added">Track</ActionButton>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
