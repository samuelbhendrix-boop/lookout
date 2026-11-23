import Link from "next/link";
import { getSession, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { storedStrategies, type Strategy } from "@/lib/strategy";
import { CompetitorTabs } from "@/components/CompetitorTabs";
import { CompanyLogo } from "@/components/CompanyLogo";
import { ActionButton } from "@/components/ActionButton";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Competitor strategy" };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const TONE: Record<Strategy["confidence"], string> = { high: "bg-emerald-50 text-emerald-800", medium: "bg-amber-50 text-amber-900", low: "bg-stone-100 text-stone-600" };

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <div><h3 className="text-xs font-semibold text-stone-500">{title}</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-stone-700">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
}
function Line({ title, text }: { title: string; text: string | null | undefined }) {
  if (!text) return null;
  return <div><h3 className="text-xs font-semibold text-stone-500">{title}</h3><p className="mt-1 text-sm text-stone-700">{text}</p></div>;
}

/** Each competitor's commercial product strategy, read by AI from everything the site holds on them. */
export default async function StrategyPage() {
  const session = (await getSession())!;
  const ws = await db.workspace.findUnique({ where: { id: session.workspaceId }, select: { ownCompetitorId: true } });
  const comps = (await db.competitor.findMany({ where: { workspaceId: session.workspaceId }, orderBy: [{ tier: "asc" }, { name: "asc" }], select: { id: true, name: true, tier: true } })).filter((c) => c.id !== ws?.ownCompetitorId);
  const reads = await storedStrategies(comps.map((c) => c.id));
  const canWrite = hasRole(session.role, "ANALYST");
  const pending = comps.filter((c) => !reads.has(c.id));
  // Written reads first, then those still to come, then carriers with too little to read.
  const rank = (id: string) => (reads.get(id) === "thin" ? 2 : reads.has(id) ? 0 : 1);
  comps.sort((a, b) => rank(a.id) - rank(b.id));
  return (
    <div className="space-y-5">
      <CompetitorTabs view="strategy" sub="What each competitor is trying to do in commercial insurance, read by AI from their own marketing, their filings, their numbers and recent moves. Rewritten when the evidence changes, weekly at most." />
      {comps.length > 0 && (
        <nav aria-label="Competitors" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {comps.map((c) => <a key={c.id} href={`#${c.id}`} className={reads.get(c.id) && reads.get(c.id) !== "thin" ? "underline decoration-stone-300 hover:decoration-stone-900" : "text-stone-400"}>{c.name}</a>)}
        </nav>
      )}
      {!comps.length && <Empty title="No competitors yet">Add competitors on the Overview page and their strategy reads will be written here.</Empty>}
      {comps.map((c) => {
        const got = reads.get(c.id), thin = got === "thin", s = got && got !== "thin" ? got : null;
        return (
          <section key={c.id} id={c.id} className="card scroll-mt-4 space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <CompanyLogo id={c.id} name={c.name} size={32} />
                <div className="min-w-0">
                  <h2 className="font-semibold"><Link href={`/competitors/${c.id}`} className="hover:underline">{c.name}</Link></h2>
                  {s && <p className="text-xs text-stone-500">Written {day(s.generatedAt)} from: {s.sources.join(", ").toLowerCase()}</p>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {s && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[s.confidence]}`}>{s.confidence[0].toUpperCase() + s.confidence.slice(1)} confidence</span>}
                {canWrite && !thin && <ActionButton method="POST" path={`/competitors/${c.id}/strategy`} className="btn-ghost text-xs" doneText="Written">{s ? "Rewrite" : "Write now"}</ActionButton>}
              </div>
            </div>
            {s ? (
              <>
                <p className="text-lg font-semibold leading-snug tracking-tight">{s.headline}</p>
                <p className="max-w-4xl text-sm leading-relaxed text-stone-700">{s.summary}</p>
                <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
                  <Bullets title="Where they play" items={s.whereTheyPlay} />
                  <Bullets title="How the portfolio is built" items={s.productStrategy} />
                  <Line title="Pricing" text={s.pricing} />
                  <Line title="Momentum" text={s.momentum} />
                  <Line title="How they sell" text={s.distribution} />
                  <Line title="Partners" text={s.partners} />
                  <Bullets title="Recent moves" items={s.recentMoves} />
                  <Bullets title="What it means for us" items={s.versusUs} />
                  <Bullets title="What to watch" items={s.watch} />
                </div>
                {s.basis && <p className="border-t border-stone-100 pt-3 text-xs text-stone-500">Basis: {s.basis}</p>}
              </>
            ) : thin ? (
              <p className="text-sm text-stone-500">Not enough on this site to read a commercial strategy: there is no marketing read, loss-ratio filing or plan filing for this carrier in New England.</p>
            ) : (
              <p className="text-sm text-stone-500">Not written yet. Reads are written in the background a few at a time{canWrite ? ", or use “Write now” (it takes about a minute)" : ""}.</p>
            )}
          </section>
        );
      })}
      {pending.length > 0 && reads.size > 0 && <p className="text-xs text-stone-500">{pending.length} still to be written.</p>}
      <p className="text-xs text-stone-500">These are AI reads of the evidence on this site, not statements from the carriers. Member, premium and loss-ratio figures lag by a year or more; large group product detail comes only from carriers&apos; public websites. Check a figure against its source page before quoting it.</p>
    </div>
  );
}
