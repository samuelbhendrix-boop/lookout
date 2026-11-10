import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { briefing } from "@/lib/briefing";
import { AUTO_FILTER_TAG, MAX_ARTICLE_AGE_DAYS } from "@/lib/relevance";
import { issuerPatternFor } from "@/lib/marketdata/queries";
import { Empty, Importance, StatusDot, TypeBadge, timeAgo } from "@/components/ui";
import { QuickTriage } from "@/components/QuickTriage";
import { NewSignalForm } from "@/components/NewSignalForm";
import { NotIncluded } from "@/components/NotIncluded";
import { StarterPacks } from "@/components/StarterPacks";
import { packsWithStatus } from "@/lib/starter-packs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Updates" };

/**
 * One feed for everything that moved: news about competitors and changes detected in the data (rate filings, negotiated
 * rates, networks, accounts). "Your competitors" = workspace signals (triageable); "Whole market" = every carrier's
 * detected changes, tracked or not.
 */
const CATS = {
  pricing: { label: "Pricing", tags: ["rate-filing", "rate-change"], types: ["PRICING"], kinds: ["rate_filing", "rate_change"] },
  network: { label: "Network", tags: ["network-add", "network-drop"], types: ["NETWORK"], kinds: ["network_add", "network_drop"] },
  product: { label: "Product", tags: [], types: ["PRODUCT"], kinds: [] },
  sales: { label: "Sales", tags: ["account-won", "account-lost"], types: ["PARTNERSHIP"], kinds: ["account_won", "account_lost"] },
  news: { label: "News only", tags: [], types: [], kinds: [] },
} as const;
type Cat = keyof typeof CATS;
const KIND: Record<string, { label: string; tone: string }> = {
  "account-won": { label: "Account won", tone: "bg-emerald-600" }, "account-lost": { label: "Account lost", tone: "bg-red-600" },
  "rate-filing": { label: "Rate filing", tone: "bg-sky-700" }, "rate-change": { label: "Negotiated rates", tone: "bg-amber-600" },
  "network-add": { label: "Network add", tone: "bg-emerald-600" }, "network-drop": { label: "Network drop", tone: "bg-red-600" },
};
const DAYS = [7, 30, 90, 365];

export default async function UpdatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const view = sp.view === "market" ? "market" : "mine";
  const cat = (sp.cat && sp.cat in CATS ? sp.cat : undefined) as Cat | undefined;
  const days = DAYS.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const major = sp.major === "1";
  const state = sp.state && /^[A-Z]{2}$/.test(sp.state) ? sp.state : undefined;
  const q = sp.q?.trim() || undefined;
  const status = sp.status && ["NEW", "REVIEWED", "ESCALATED", "ARCHIVED"].includes(sp.status) ? sp.status : undefined;
  const competitors = await db.competitor.findMany({ where: { workspaceId: session.workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true, aliases: true, issuerPattern: true } });
  const comp = competitors.find((c) => c.id === (sp.competitorId ?? sp.competitor));
  const since = new Date(Date.now() - days * 864e5);
  const qs = (o: Record<string, string | undefined>) => `/updates?${new URLSearchParams(Object.entries({ view, cat, days: String(days), major: major ? "1" : undefined, state, q, status, competitorId: comp?.id, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const chip = (on: boolean) => `rounded-full px-2.5 py-1 ${on ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`;
  const canEdit = session.role !== "VIEWER";

  // ── Your competitors: signals (news + data-detected), story leads only.
  let signals: Awaited<ReturnType<typeof loadSignals>> = [];
  async function loadSignals() {
    const c = cat ? CATS[cat] : null;
    const catWhere: Prisma.SignalWhereInput | undefined = !c ? undefined
      : cat === "news" ? { tags: { none: { tag: { name: "market-data" } } } }
      : { OR: [...(c.tags.length ? [{ tags: { some: { tag: { name: { in: [...c.tags] } } } } }] : []), ...(c.types.length ? [{ type: { in: [...c.types] as never[] }, tags: { none: { tag: { name: "market-data" } } } }] : [])] };
    return db.signal.findMany({
      where: {
        workspaceId: session.workspaceId, duplicateOfId: null, status: status ? (status as never) : { not: "ARCHIVED" },
        competitorId: comp?.id, importance: major ? { gte: 4 } : undefined,
        AND: [
          { OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }] },
          ...(catWhere ? [catWhere] : []),
          ...(q ? [{ OR: [{ title: { contains: q, mode: "insensitive" as const } }, { summary: { contains: q, mode: "insensitive" as const } }] }] : []),
          ...(status === "ARCHIVED" ? [] : [{ tags: { none: { tag: { name: AUTO_FILTER_TAG } } } }]),
        ],
      },
      orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 150,
      include: { competitor: { select: { id: true, name: true } }, source: { select: { name: true } }, tags: { include: { tag: true } }, _count: { select: { coverage: true, comments: true } } },
    });
  }
  // ── Whole market: every carrier's detected changes.
  let events: Awaited<ReturnType<typeof db.marketEvent.findMany>> = [];
  if (view === "mine") signals = await loadSignals();
  else {
    const kinds = cat ? [...CATS[cat].kinds] : undefined;
    const compIds = comp ? (await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "MarketEvent" WHERE carrier ~* ${issuerPatternFor(comp)}`).map((r) => r.id) : null;
    events = cat === "news" || cat === "product" ? [] : await db.marketEvent.findMany({
      where: { ...(kinds ? { kind: { in: kinds } } : {}), ...(state ? { state } : {}), ...(compIds ? { id: { in: compIds } } : {}), importance: { gte: major ? 4 : 2 }, occurredAt: { gte: since },
        ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { carrier: { contains: q, mode: "insensitive" } }] } : {}) },
      orderBy: [{ occurredAt: "desc" }, { importance: "desc" }], take: 200,
    });
  }
  const top = view === "mine" && !cat && !comp && !q ? (await briefing(session.workspaceId, 7)).top : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Updates</h1>
          <p className="text-sm text-stone-500">News on your competitors and every change detected in the data, newest first.</p>
        </div>
        <div className="flex gap-2">
          {view === "mine" && <a className="btn-ghost" href={`/api/v1/signals/export?${new URLSearchParams(Object.entries({ competitorId: comp?.id, q }).filter(([, v]) => v) as [string, string][])}`}>Export CSV</a>}
          {canEdit && view === "mine" && <NewSignalForm competitors={competitors.map((c) => ({ id: c.id, name: c.name }))} />}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Link href={qs({ view: "mine", state: undefined })} className={chip(view === "mine")}>Your competitors</Link>
          <Link href={qs({ view: "market" })} className={chip(view === "market")}>Whole market</Link>
          <span className="mx-2 text-stone-300">|</span>
          <Link href={qs({ cat: undefined })} className={chip(!cat)}>Everything</Link>
          {(Object.keys(CATS) as Cat[]).filter((k) => view === "mine" || (k !== "news" && k !== "product")).map((k) => <Link key={k} href={qs({ cat: k })} className={chip(cat === k)}>{CATS[k].label}</Link>)}
          <span className="mx-2 text-stone-300">|</span>
          {DAYS.map((d) => <Link key={d} href={qs({ days: String(d) })} className={chip(days === d)}>{d === 365 ? "1 yr" : `${d}d`}</Link>)}
          <Link href={qs({ major: major ? undefined : "1" })} className={chip(major)}>Major only</Link>
        </div>
        <form className="flex flex-wrap gap-2" action="/updates">
          <input type="hidden" name="view" value={view} />{cat && <input type="hidden" name="cat" value={cat} />}<input type="hidden" name="days" value={days} />{major && <input type="hidden" name="major" value="1" />}
          <input name="q" defaultValue={q} placeholder="Search" className="input max-w-xs py-1.5 text-sm" />
          <select name="competitorId" defaultValue={comp?.id ?? ""} className="input max-w-[220px] py-1.5 text-sm">
            <option value="">All competitors</option>
            {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {view === "market" ? (
            <select name="state" defaultValue={state ?? ""} className="input max-w-[120px] py-1.5 text-sm"><option value="">All states</option>{["MA", "CT", "RI", "NH", "VT", "ME"].map((s) => <option key={s}>{s}</option>)}</select>
          ) : (
            <select name="status" defaultValue={status ?? ""} className="input max-w-[140px] py-1.5 text-sm"><option value="">Active</option>{["NEW", "REVIEWED", "ESCALATED", "ARCHIVED"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select>
          )}
          <button className="btn-ghost py-1.5">Apply</button>
        </form>
      </div>

      {top.length > 0 && (
        <section>
          <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-stone-500">Top {top.length} this week</h2>
          <ol className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {top.map((it, i) => (
              <li key={it.id} className="card p-3">
                <p className="text-[11px] text-stone-500"><span className="mr-1 font-mono text-stone-400">{i + 1}</span>{it.kind ? KIND[it.kind.replace("_", "-")]?.label : it.type.toLowerCase()} · {it.competitor ?? "market"}</p>
                <Link href={it.href} className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug hover:underline">{it.title}</Link>
                <p className="mt-1 line-clamp-2 text-xs text-stone-500">{it.why}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {view === "mine" ? (
        signals.length === 0 ? (competitors.length === 0 ? (
          <Empty title="No competitors yet">
            <div className="mt-3 flex flex-col items-center gap-3">
              <p>Pick a starter pack: each adds the carriers in a market, their news feeds and regulator news.</p>
              {canEdit && <div className="w-full max-w-2xl"><StarterPacks packs={packsWithStatus(new Set())} /></div>}
            </div>
          </Empty>
        ) : <Empty title="Nothing matches">Widen the time window or clear a filter.</Empty>) : (
          <ul className="card divide-y divide-stone-100">
            {signals.map((s) => {
              const kind = s.tags.map((t) => t.tag.name).find((n) => KIND[n]);
              return (
                <li key={s.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="pt-1.5"><StatusDot status={s.status} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                      {kind ? <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium text-white ${KIND[kind].tone}`}>{KIND[kind].label}</span> : <TypeBadge type={s.type} />}
                      {s.competitor && <Link href={qs({ competitorId: s.competitor.id })} className="font-medium text-stone-800 hover:underline">{s.competitor.name}</Link>}
                      <span>{kind ? "detected from data" : s.source?.name ?? "manual"}</span>
                      <span className="font-mono">{timeAgo(s.publishedAt ?? s.createdAt)}</span>
                      {s._count.coverage > 0 && <span className="rounded bg-stone-100 px-1.5 text-stone-700">+{s._count.coverage} outlets</span>}
                      {s._count.comments > 0 && <span>💬 {s._count.comments}</span>}
                    </div>
                    <Link href={`/signals/${s.id}`} className="font-medium leading-snug hover:underline">{s.title}</Link>
                    {s.summary && <p className="mt-0.5 line-clamp-2 text-sm text-stone-500">{s.summary}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Importance value={s.importance} />
                    {canEdit && <QuickTriage id={s.id} status={s.status} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : (
        events.length === 0 ? <Empty title="No changes match">Widen the time window or clear a filter.</Empty> : (
          <div className="card divide-y divide-stone-100">
            {events.map((e) => {
              const k = KIND[e.kind.replace("_", "-")];
              return (
                <div key={e.id} className="flex gap-3 px-4 py-2.5">
                  <div className="w-20 shrink-0 font-mono text-xs text-stone-400">{e.occurredAt.toISOString().slice(0, 10)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className={`mr-2 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium text-white ${k?.tone ?? "bg-stone-500"}`}>{k?.label ?? e.kind}</span>
                      {e.url ? <Link href={e.url} className="font-medium hover:underline">{e.title}</Link> : <span className="font-medium">{e.title}</span>}
                      {e.importance >= 4 && <span className="ml-1.5 text-[10px] font-semibold text-red-700">MAJOR</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">{e.summary}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
      {(signals.length === 150 || events.length === 200) && <p className="text-xs text-stone-500">Showing the most recent {view === "mine" ? 150 : 200}; narrow with the filters.</p>}

      <NotIncluded items={[
        "Your competitors: news from your sources plus changes detected for carriers you track. Whole market: every carrier's detected changes, tracked or not; news is only collected for tracked competitors.",
        `Articles older than ${MAX_ARTICLE_AGE_DAYS} days are never ingested; items that mention no tracked competitor are auto-archived (status: archived).`,
        "Detected changes: Form 5500 account moves (100+ participant plans), ACA rate filings, and month-over-month negotiated-rate and hospital-network changes. A network drop can be a file-format change rather than a terminated contract.",
      ]} />
    </div>
  );
}
