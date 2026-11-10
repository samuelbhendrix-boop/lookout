import { Suspense } from "react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { matchCompetitor } from "@/lib/match";
import { AI_CATEGORIES, aiBrief } from "@/lib/ainews";
import { FilterBar } from "@/components/FilterBar";
import { CompanyLogo } from "@/components/CompanyLogo";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI watch" };

const TONE: Record<string, string> = {
  "Payers using AI": "bg-sky-50 text-sky-800", "Prior auth & claims": "bg-amber-50 text-amber-800", "Regulation & policy": "bg-violet-50 text-violet-800",
  "Providers & care delivery": "bg-teal-50 text-teal-800", "Vendors & deals": "bg-stone-100 text-stone-700", "Frontier labs & platforms": "bg-rose-50 text-rose-800",
};
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const IMPACT = ["", "Background", "Notable", "High"];

export default async function AiWatchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  const days = Number(sp.days) || 30;
  const minImpact = sp.impact ? Number(sp.impact) : 2;
  const since = new Date(Date.now() - days * 864e5);
  const [all, comps, pending] = await Promise.all([
    db.aiNews.findMany({ where: { relevant: true, OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }] }, orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take: 600 }),
    session ? db.competitor.findMany({ where: { workspaceId: session.workspaceId }, select: { id: true, name: true, aliases: true } }) : [],
    db.aiNews.count({ where: { judged: false } }),
  ]);
  const items = all.map((n) => { const cid = matchCompetitor(`${n.title} ${n.companies.join(" ")}`, comps); return { ...n, comp: cid ? comps.find((c) => c.id === cid) ?? null : null }; });
  const rows = items.filter((n) => (n.impact ?? 1) >= minImpact && (!sp.category || n.category === sp.category) && (!sp.competitor || n.comp?.id === sp.competitor));
  const brief = await aiBrief(items.filter((n) => Date.now() - (n.publishedAt ?? n.createdAt).getTime() < 14 * 864e5).sort((a, b) => (b.impact ?? 0) - (a.impact ?? 0))).catch(() => null);
  const byId = new Map(items.map((n) => [n.id, n]));
  const counts = AI_CATEGORIES.map((c) => [c, new Set(items.filter((n) => n.category === c && (n.impact ?? 1) >= minImpact).map((n) => n.story?.toLowerCase() ?? n.id)).size] as const);
  const catLink = (c: string) => { const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as Array<[string, string]>); if (sp.category === c) q.delete("category"); else q.set("category", c); return `?${q}`; };
  // Several outlets' versions of one event show as one entry (the judge labels each headline with its underlying story).
  const byStory = new Map<string, typeof rows>();
  for (const n of rows) { const k = n.story?.toLowerCase() ?? n.id; (byStory.get(k) ?? byStory.set(k, []).get(k)!).push(n); }
  const leads = [...byStory.values()].map((ns) => { const lead = [...ns].sort((a, b) => (b.impact ?? 0) - (a.impact ?? 0) || (b.why ? 1 : 0) - (a.why ? 1 : 0))[0]; return { ...lead, more: ns.filter((x) => x !== lead), latest: new Date(Math.max(...ns.map((x) => (x.publishedAt ?? x.createdAt).getTime()))) }; }).sort((a, b) => b.latest.getTime() - a.latest.getTime());
  const groups = new Map<string, typeof leads>();
  for (const n of leads) { const k = n.latest.toISOString().slice(0, 10); (groups.get(k) ?? groups.set(k, []).get(k)!).push(n); }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">AI watch</h1>
        <p className="text-sm text-stone-500">AI-industry developments that bear on health insurance: payers&apos; own AI, prior auth and claims, rules, provider-side AI, vendors and the big labs. Collected every few hours and screened for relevance.</p>
      </div>

      {brief && brief.points.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-stone-500">What matters this fortnight</div>
          <ul className="space-y-2 text-sm">
            {brief.points.map((p, i) => (
              <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-900" />
                <div><div>{p.text}</div>{p.ids.length > 0 && <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-stone-500">{p.ids.map((id) => byId.get(id)).filter(Boolean).slice(0, 3).map((n) => <a key={n!.id} href={n!.url} target="_blank" rel="noreferrer" className="max-w-[28rem] truncate hover:underline">↗ {n!.title}</a>)}</div>}</div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-stone-400">Written by {brief.model} from the stories below; check the source before quoting.</p>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {counts.map(([c, n]) => <a key={c} href={catLink(c)} className={`rounded px-2 py-1 ${TONE[c]} ${sp.category === c ? "ring-1 ring-stone-900" : ""} ${n ? "" : "opacity-40"}`}>{c} <span className="tabular-nums">{n}</span></a>)}
      </div>

      <Suspense>
        <FilterBar filters={[
          { key: "impact", label: "Impact", options: [{ value: "3", label: "High only" }, { value: "1", label: "Everything relevant" }] },
          { key: "days", label: "Window", options: [{ value: "7", label: "7 days" }, { value: "90", label: "90 days" }, { value: "365", label: "12 months" }] },
          { key: "category", label: "Category", options: AI_CATEGORIES.map((c) => ({ value: c, label: c })) },
          { key: "competitor", label: "Mentions", options: comps.filter((c) => items.some((n) => n.comp?.id === c.id)).map((c) => ({ value: c.id, label: c.name })) },
        ]} />
      </Suspense>

      <div className="space-y-4">
        {[...groups].map(([d, ns]) => (
          <section key={d}>
            <h2 className="mb-1 font-mono text-[10px] uppercase tracking-wide text-stone-500">{day(new Date(d + "T12:00:00Z"))}</h2>
            <div className="card divide-y divide-stone-100">
              {ns.map((n) => (
                <div key={n.id} className="flex gap-3 px-4 py-2.5">
                  <span title={`Impact: ${IMPACT[n.impact ?? 1]}`} className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.impact === 3 ? "bg-red-500" : n.impact === 2 ? "bg-amber-400" : "bg-stone-300"}`} />
                  <div className="min-w-0 flex-1">
                    <a href={n.url} target="_blank" rel="noreferrer" className="text-sm font-medium leading-snug hover:underline">{n.title}</a>
                    {n.why && <div className="text-xs text-stone-600">{n.why}</div>}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-stone-500">
                      {n.category && <span className={`rounded px-1.5 py-0.5 ${TONE[n.category] ?? "bg-stone-100"}`}>{n.category}</span>}
                      {n.comp && <span className="inline-flex items-center gap-1 rounded bg-stone-100 px-1.5 py-0.5 text-stone-700"><CompanyLogo id={n.comp.id} name={n.comp.name} size={11} />{n.comp.name}</span>}
                      {n.outlet && <span>{n.outlet}</span>}
                      {n.more.length > 0 && <details className="inline"><summary className="cursor-pointer list-none text-stone-500 hover:text-stone-800">+{n.more.length} more coverage</summary><ul className="mt-1 space-y-0.5">{n.more.slice(0, 12).map((m) => <li key={m.id}><a href={m.url} target="_blank" rel="noreferrer" className="hover:underline">{m.title}</a>{m.outlet ? <span className="text-stone-400"> · {m.outlet}</span> : null}</li>)}</ul></details>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {!rows.length && <p className="card px-4 py-6 text-sm text-stone-500">{all.length ? "Nothing matches these filters." : pending ? `Screening ${pending} stories now; check back in a few minutes.` : "Collecting stories; the first batch arrives within a few minutes of the worker starting."}</p>}
      </div>
    </div>
  );
}
