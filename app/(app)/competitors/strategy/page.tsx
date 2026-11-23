import Link from "next/link";
import { getSession, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { headToHead, isWriting, storedStrategies, type Strategy } from "@/lib/strategy";
import { CompetitorTabs } from "@/components/CompetitorTabs";
import { CompanyLogo } from "@/components/CompanyLogo";
import { StrategyPicker, WriteRead } from "@/components/StrategyControls";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Competitor strategy" };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const TONE: Record<Strategy["confidence"], string> = { high: "bg-emerald-50 text-emerald-800", medium: "bg-amber-50 text-amber-900", low: "bg-stone-100 text-stone-600" };
const int = (v: number | null) => (v == null ? "" : Math.round(v).toLocaleString("en-US"));
const usd = (v: number | null) => (v == null ? "" : `$${Math.round(v).toLocaleString("en-US")}`);
const pct = (v: number | null) => (v == null ? "" : `${(v * 100).toFixed(1)}%`);

type Section = { title: string; get: (s: Strategy) => string[] | string | null | undefined };
const SECTIONS: Section[] = [
  { title: "Where they play", get: (s) => s.whereTheyPlay }, { title: "How the portfolio is built", get: (s) => s.productStrategy },
  { title: "Pricing", get: (s) => s.pricing }, { title: "Momentum", get: (s) => s.momentum },
  { title: "How they sell", get: (s) => s.distribution }, { title: "Partners", get: (s) => s.partners },
  { title: "Recent moves", get: (s) => s.recentMoves }, { title: "What it means for us", get: (s) => s.versusUs }, { title: "What to watch", get: (s) => s.watch },
];
const empty = (v: string[] | string | null | undefined) => !v || (Array.isArray(v) && !v.length);
function Body({ v }: { v: string[] | string | null | undefined }) {
  if (empty(v)) return <p className="text-sm text-stone-400">Not shown in the evidence</p>;
  return Array.isArray(v) ? <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">{v.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-sm text-stone-700">{v}</p>;
}
function Confidence({ s }: { s: Strategy }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE[s.confidence]}`}>{s.confidence[0].toUpperCase() + s.confidence.slice(1)} confidence</span>;
}
type C = { id: string; name: string; us: boolean };
function Head({ c, s, canWrite }: { c: C; s: Strategy; canWrite: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <CompanyLogo id={c.id} name={c.name} size={32} />
        <div className="min-w-0">
          <h2 className="font-semibold"><Link href={`/competitors/${c.id}`} className="hover:underline">{c.name}</Link>{c.us && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-ink">Us</span>}</h2>
          <p className="text-xs text-stone-500">Written {day(s.generatedAt)} from: {s.sources.join(", ").toLowerCase()}</p>
        </div>
      </div>
      <div className="flex items-center gap-3"><Confidence s={s} />{canWrite && <WriteRead id={c.id} has writing={isWriting(c.id)} />}</div>
    </div>
  );
}

/** Each competitor's commercial product strategy, read by AI from everything the site holds on them. */
export default async function StrategyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const ws = await db.workspace.findUnique({ where: { id: session.workspaceId }, select: { ownCompetitorId: true } });
  const all: C[] = (await db.competitor.findMany({ where: { workspaceId: session.workspaceId }, orderBy: [{ tier: "asc" }, { name: "asc" }], select: { id: true, name: true } })).map((c) => ({ ...c, us: c.id === ws?.ownCompetitorId }));
  const reads = await storedStrategies(all.map((c) => c.id));
  const read = (id: string | null | undefined) => { const r = id ? reads.get(id) : null; return r && r !== "thin" ? r : null; };
  const canWrite = hasRole(session.role, "ANALYST");
  const thin = all.filter((c) => reads.get(c.id) === "thin");
  const comps = all.filter((c) => reads.get(c.id) !== "thin");
  const a = comps.find((c) => c.id === sp.c) ?? null, b = a ? comps.find((c) => c.id === sp.vs && c.id !== a.id) ?? null : null;
  const sa = read(a?.id), sb = read(b?.id);
  const numbers = a && b ? await headToHead(session.workspaceId, a.name, b.name) : [];
  const options = [...comps].sort((x, y) => Number(y.us) - Number(x.us) || x.name.localeCompare(y.name)).map((c) => ({ id: c.id, name: c.us ? `${c.name} (us)` : c.name, ready: !!read(c.id) }));
  return (
    <div className="space-y-5">
      <CompetitorTabs view="strategy" sub="What each carrier is trying to do in commercial insurance, read by AI from their own marketing, their filings, their numbers and recent moves. Rewritten when the evidence changes, weekly at most." />
      {all.length > 0 ? <StrategyPicker options={options} c={a?.id ?? null} vs={b?.id ?? null} /> : <Empty title="No competitors yet">Add competitors on the Overview page and their strategy reads will be written here.</Empty>}

      {/* All competitors: one line each */}
      {!a && comps.length > 0 && (
        <section className="card divide-y divide-stone-100">
          {comps.filter((c) => !c.us).concat(comps.filter((c) => c.us)).map((c) => {
            const s = read(c.id);
            return (
              <div key={c.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3.5">
                <div className="flex w-64 shrink-0 items-center gap-2.5"><CompanyLogo id={c.id} name={c.name} size={24} /><span className="text-sm font-medium">{c.name}</span>{c.us && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-ink">Us</span>}</div>
                {s ? (
                  <>
                    <Link href={`/competitors/strategy?c=${c.id}`} className="min-w-0 flex-1 basis-80 text-sm text-stone-700 hover:text-stone-900 hover:underline">{s.headline}</Link>
                    <span className="flex shrink-0 items-center gap-3"><Confidence s={s} />{!c.us && ws?.ownCompetitorId && read(ws.ownCompetitorId) && <Link href={`/competitors/strategy?c=${c.id}&vs=${ws.ownCompetitorId}`} className="text-xs underline">Compare with us</Link>}</span>
                  </>
                ) : (
                  <span className="flex flex-1 flex-wrap items-center gap-3 text-sm text-stone-500">Not written yet. Reads are written in the background a few at a time.{canWrite && <WriteRead id={c.id} has={false} writing={isWriting(c.id)} />}</span>
                )}
              </div>
            );
          })}
        </section>
      )}
      {!a && thin.length > 0 && <p className="text-xs text-stone-500">No read for {thin.map((c) => c.name).join(", ")}: this site holds no marketing read, loss-ratio filing or plan filing for them in New England, so there is nothing to base one on. That is expected, not an error.</p>}

      {/* One competitor */}
      {a && !b && (sa ? (
        <section className="card space-y-4 p-5">
          <Head c={a} s={sa} canWrite={canWrite} />
          <p className="text-lg font-semibold leading-snug tracking-tight">{sa.headline}</p>
          <p className="max-w-4xl text-sm leading-relaxed text-stone-700">{sa.summary}</p>
          <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            {SECTIONS.filter((x) => !empty(x.get(sa))).map((x) => <div key={x.title}><h3 className="mb-1 text-xs font-semibold text-stone-500">{x.title}</h3><Body v={x.get(sa)} /></div>)}
          </div>
          {sa.basis && <p className="border-t border-stone-100 pt-3 text-xs text-stone-500">Basis: {sa.basis}</p>}
        </section>
      ) : <Empty title="Not written yet">This read hasn&apos;t been written.</Empty>)}

      {/* Head to head */}
      {a && b && sa && sb && (
        <>
          <section className="card overflow-x-auto p-5">
            <div className="grid min-w-[640px] grid-cols-2 gap-x-8 gap-y-4">
              <Head c={a} s={sa} canWrite={canWrite} /><Head c={b} s={sb} canWrite={canWrite} />
              <p className="text-base font-semibold leading-snug tracking-tight">{sa.headline}</p><p className="text-base font-semibold leading-snug tracking-tight">{sb.headline}</p>
              <p className="text-sm leading-relaxed text-stone-700">{sa.summary}</p><p className="text-sm leading-relaxed text-stone-700">{sb.summary}</p>
            </div>
          </section>
          {numbers.length > 0 && (
            <section className="card overflow-x-auto p-5">
              <h2 className="font-semibold">By the numbers</h2>
              <p className="text-xs text-stone-500">Fully insured business, latest year filed, wherever either carrier has 1,000 or more members.</p>
              <table data-static className="mt-3 w-full min-w-[640px] text-sm tabular-nums">
                <thead>
                  <tr className="text-xs text-stone-500"><th rowSpan={2} className="py-1.5 pr-4 text-left align-bottom font-medium">Market</th><th colSpan={3} className="border-b border-stone-200 px-3 py-1.5 text-center font-medium">{a.name}</th><th colSpan={3} className="border-b border-stone-200 px-3 py-1.5 text-center font-medium">{b.name}</th></tr>
                  <tr className="text-right text-xs text-stone-500">{[0, 1].flatMap((i) => ["Members", "Premium PMPM", "Loss ratio"].map((h) => <th key={`${i}${h}`} className="px-3 py-1.5 font-medium">{h}</th>))}</tr>
                </thead>
                <tbody>
                  {numbers.map((r) => (
                    <tr key={`${r.state}${r.segment}`} className="border-t border-stone-100 text-right">
                      <td className="py-2 pr-4 text-left">{r.state} · {r.segment}</td>
                      {[r.a, r.b].flatMap((x, i) => [<td key={`${i}l`} className={`px-3 py-2 ${i ? "" : "border-l border-stone-100"} ${(x.lives ?? 0) > ((i ? r.a : r.b).lives ?? 0) ? "font-semibold" : ""}`}>{int(x.lives)}</td>, <td key={`${i}p`} className="px-3 py-2">{usd(x.pmpm)}</td>, <td key={`${i}r`} className="px-3 py-2">{pct(x.lr)}</td>])}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <section className="card overflow-x-auto p-5">
            <div className="min-w-[640px] divide-y divide-stone-100">
              {SECTIONS.filter((x) => !(empty(x.get(sa)) && empty(x.get(sb)))).map((x) => (
                <div key={x.title} className="py-4 first:pt-0 last:pb-0">
                  <h3 className="mb-2 text-xs font-semibold text-stone-500">{x.title}</h3>
                  <div className="grid grid-cols-2 gap-x-8"><Body v={x.get(sa)} /><Body v={x.get(sb)} /></div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
      {a && b && !(sa && sb) && <Empty title="Can't compare yet">One of these reads hasn&apos;t been written.</Empty>}

      <p className="text-xs text-stone-500">These are AI reads of the evidence on this site, not statements from the carriers. Member, premium and loss-ratio figures lag by a year or more; large group product detail comes only from carriers&apos; public websites. Check a figure against its source page before quoting it.</p>
    </div>
  );
}
