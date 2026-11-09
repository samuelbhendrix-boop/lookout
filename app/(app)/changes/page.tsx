import Link from "next/link";
import { DataAsOf } from "@/components/DataAsOf";
import { db } from "@/lib/db";
import { fmtInt } from "@/components/charts";
import { NotIncluded } from "@/components/NotIncluded";
import { getSession } from "@/lib/auth";
import { issuerPatternFor } from "@/lib/marketdata/queries";

export const dynamic = "force-dynamic";

const KINDS: Record<string, { label: string; tone: string }> = {
  account_won: { label: "Account won", tone: "bg-emerald-50 text-emerald-800" },
  account_lost: { label: "Account lost", tone: "bg-red-50 text-red-800" },
  rate_filing: { label: "Rate filing", tone: "bg-sky-50 text-sky-800" },
  rate_change: { label: "Negotiated rate change", tone: "bg-amber-50 text-amber-800" },
  network_add: { label: "Network add", tone: "bg-emerald-50 text-emerald-800" },
  network_drop: { label: "Network drop", tone: "bg-red-50 text-red-800" },
};

export default async function ChangesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const kind = sp.kind && KINDS[sp.kind] ? sp.kind : undefined;
  const state = sp.state && /^[A-Z]{2}$/.test(sp.state) ? sp.state : undefined;
  const carrier = sp.carrier?.trim() || undefined;
  const minImp = Number(sp.min ?? 2) || 2;
  // ?competitor=<id>: match every legal-entity name of that competitor via its issuer pattern.
  const session = await getSession();
  const comp = sp.competitor && session ? await db.competitor.findFirst({ where: { id: sp.competitor, workspaceId: session.workspaceId } }) : null;
  const compIds = comp ? (await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "MarketEvent" WHERE carrier ~* ${issuerPatternFor(comp)}`).map((r) => r.id) : null;
  const where = { ...(kind ? { kind } : {}), ...(state ? { state } : {}), ...(carrier ? { carrier: { contains: carrier, mode: "insensitive" as const } } : {}), ...(compIds ? { id: { in: compIds } } : {}), importance: { gte: minImp } };
  const [events, counts, carriers, history] = await Promise.all([
    db.marketEvent.findMany({ where, orderBy: [{ occurredAt: "desc" }, { importance: "desc" }], take: 200 }),
    db.marketEvent.groupBy({ by: ["kind"], _count: true, where: { importance: { gte: minImp } } }),
    db.marketEvent.groupBy({ by: ["carrier"], _count: true, orderBy: { _count: { carrier: "desc" } }, take: 25 }),
    db.$queryRaw<Array<{ months: bigint }>>`SELECT count(DISTINCT month) months FROM "RateHistory"`,
  ]);
  const months = Number(history[0]?.months ?? 0);
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ kind, state, carrier, competitor: comp?.id, min: String(minImp), ...o }).filter(([, v]) => v) as [string, string][]);
    return `/changes?${p}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Market changes{comp ? ` · ${comp.name}` : ""}</h1>
        <DataAsOf datasets={["dol_5500", "urrt", "rates"]} />
        <p className="max-w-3xl text-sm text-stone-500">
          What moved, detected from the data itself: employers switching carriers (Form 5500, year over year), ACA rate filings, and month-over-month
          changes in negotiated rates and hospital networks. Each change also lands in your feed as a signal for the competitor involved, so alert rules and
          weekly digests pick it up.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Link href={qs({ kind: undefined })} className={`rounded-full px-2.5 py-1 ${!kind ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>All</Link>
        {Object.entries(KINDS).map(([k, v]) => (
          <Link key={k} href={qs({ kind: k })} className={`rounded-full px-2.5 py-1 ${kind === k ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>
            {v.label} <span className="opacity-60">{fmtInt(counts.find((c) => c.kind === k)?._count ?? 0)}</span>
          </Link>
        ))}
        <span className="mx-2 text-stone-300">|</span>
        {["MA", "NH", "RI", "ME", "CT", "VT"].map((st) => (
          <Link key={st} href={qs({ state: state === st ? undefined : st })} className={`rounded px-2 py-1 ${state === st ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>{st}</Link>
        ))}
        <span className="mx-2 text-stone-300">|</span>
        <Link href={qs({ min: minImp >= 3 ? "2" : "3" })} className={`rounded px-2 py-1 ${minImp >= 3 ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>Major only</Link>
      </div>
      <form className="flex gap-2 text-sm" action="/changes">
        {kind && <input type="hidden" name="kind" value={kind} />}
        {state && <input type="hidden" name="state" value={state} />}
        {comp && <input type="hidden" name="competitor" value={comp.id} />}
        <input name="carrier" defaultValue={carrier} placeholder="Carrier contains…" list="carriers" className="input max-w-xs" />
        <datalist id="carriers">{carriers.map((c) => <option key={c.carrier} value={c.carrier} />)}</datalist>
        <button className="btn-ghost">Filter</button>
      </form>

      <div className="card divide-y divide-stone-100">
        {events.length === 0 && <p className="px-4 py-6 text-sm text-stone-500">No changes match these filters.</p>}
        {events.map((e) => (
          <div key={e.id} className="flex gap-3 px-4 py-2.5">
            <div className="w-24 shrink-0 text-xs text-stone-400">{e.occurredAt.toISOString().slice(0, 10)}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${KINDS[e.kind]?.tone ?? "bg-stone-100"}`}>{KINDS[e.kind]?.label ?? e.kind}</span>
                {e.url ? <Link href={e.url} className="font-medium hover:underline">{e.title}</Link> : <span className="font-medium">{e.title}</span>}
                {e.importance >= 4 && <span className="ml-1.5 text-[10px] font-semibold text-red-700">MAJOR</span>}
              </p>
              <p className="mt-0.5 text-xs text-stone-500">{e.summary}</p>
            </div>
          </div>
        ))}
      </div>
      {events.length === 200 && <p className="text-xs text-stone-500">Showing the 200 most recent; narrow with the filters.</p>}

      <NotIncluded items={[
        months < 2
          ? `Negotiated-rate and network changes need two months of rate history; history started ${new Date().toISOString().slice(0, 7)}, so the first month-over-month changes appear after next month's rate imports.`
          : `Negotiated-rate and network changes compare the last two months of ${months} months of rate history.`,
        "Account changes come from Form 5500 Schedule A and only cover employers that file (100+ participants; no government or church plans). Self-funded plans name no insurer, so a self-funded employer changing administrators isn't detected — only moves between insured carriers and to self-funding.",
        "Account changes only count when the carrier covers at least 50 people and 20% of the plan's participants, so small insured add-ons to self-funded plans aren't reported as wins.",
        "Rate filings: New England ACA individual and small-group filings only (large group isn't filed publicly), as the enrollment-weighted average across renewing plans.",
        "A network drop means the hospital's inpatient prices vanished from the carrier's file; it's only reported when the carrier's overall file coverage is comparable month to month, but it can still be a file-format change rather than a contract termination.",
      ]} />
    </div>
  );
}
