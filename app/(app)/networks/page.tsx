import Link from "next/link";
import { DataAsOf } from "@/components/DataAsOf";
import { GENERAL, networkMatrix, DIRECTORY_DATE } from "@/lib/marketdata/networks";
import { NetworkMap, type MapDot } from "@/components/NetworkMap";
import { NotIncluded } from "@/components/NotIncluded";
import { Empty } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { getSession, hasRole } from "@/lib/auth";
import { historyStatus } from "@/lib/marketdata/history";

export const dynamic = "force-dynamic";

const STATES = ["MA", "NH", "RI", "ME", "CT", "VT", "all"];
const short = (n: string) => n.replace(/ Health (Plan|Care)$/, "").replace(/Blue Cross and Blue Shield/, "BCBS").replace(/Blue Cross Blue Shield of Massachusetts/, "BCBS MA").replace(/Blue Cross & Blue Shield of Rhode Island/, "BCBS RI").replace(/Anthem Blue Cross and Blue Shield/, "Anthem").replace(/Neighborhood Health Plan of Rhode Island/, "Neighborhood").replace(/Mass General Brigham Health Plan/, "MGB").replace(/Maine Community Health Options/, "CHO");

export default async function NetworksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const state = STATES.includes(sp.state ?? "") ? sp.state! : "MA";
  const all = sp.types === "all";
  const m = await networkMatrix(state);
  if (!m.month) {
    const [st, session] = await Promise.all([historyStatus(), getSession()]);
    const j = st.job;
    return (
      <div className="space-y-4">
        <h1 className="h1">Hospital networks</h1>
        <DataAsOf datasets={["rates"]} />
        <Empty title="Building network data">
          Networks are built from the {st.files} negotiated-rate files already imported; the worker rebuilds them automatically (about a minute).
          <span className="mt-2 block font-mono text-xs">
            {!st.files ? "No rate files imported yet." : !j ? "Rebuild not started yet — the worker checks every 5 minutes." : `Rebuild ${j.status.toLowerCase()} · started ${j.createdAt.toISOString().slice(11, 16)} UTC${j.lastError ? ` · ${j.lastError.slice(0, 200)}` : ""}`}
          </span>
          {session && hasRole(session.role, "ADMIN") && st.files > 0 && (
            <span className="mt-3 block"><a className="mr-3 text-xs underline" href="/status">System status</a><ActionButton method="POST" path="/market-data/rebuild-history" className="btn" doneText="Queued — refresh in a minute">Rebuild now</ActionButton></span>
          )}
        </Empty>
      </div>
    );
  }
  const carrier = m.carriers.find((c) => c.carrier === sp.carrier)?.carrier;
  const cmpA = m.carriers.find((c) => c.carrier === sp.a)?.carrier;
  const cmpB = m.carriers.find((c) => c.carrier === sp.b)?.carrier;
  const shown = m.hospitals.filter((h) => all || GENERAL.has(h.type));
  const max = Math.max(1, ...shown.map((h) => Object.keys(h.carriers).length));
  const dots: MapDot[] = shown.filter((h) => h.lat != null && h.lon != null).map((h) => {
    const n = Object.keys(h.carriers).length;
    const p = carrier ? h.carriers[carrier] : undefined;
    const status: MapDot["status"] = !h.matched ? "unknown" : carrier ? (p?.inpatient ? "in" : p?.outpatient ? "outpatient" : "out") : "count";
    const label = `${h.name} (${h.city}) — ${h.type}${h.approx ? " · location approximate" : ""}\n${!h.matched ? "No rate-file TIN matched: network status unknown" : carrier ? (p ? `In ${short(m.carriers.find((c) => c.carrier === carrier)!.carrierName)}'s files${p.inpatient ? "" : " (outpatient only)"}` : "Not priced in this carrier's files") : `Priced by ${n} carrier${n === 1 ? "" : "s"}`}`;
    return { key: h.ccn, lat: h.lat!, lon: h.lon!, label, status, count: n, max };
  });
  const href = (o: Record<string, string | undefined>) => `/networks?${new URLSearchParams(Object.entries({ state, carrier, types: all ? "all" : undefined, ...o }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Hospital networks</h1>
        <DataAsOf datasets={["rates"]} />
        <p className="max-w-3xl text-sm text-stone-500">
          Which hospitals each carrier contracts with, read from their negotiated-rate files ({m.month}): a hospital is in a carrier&apos;s network when the
          carrier&apos;s files price care there. Breadth = share of the state&apos;s {m.general} matched acute, critical-access and children&apos;s hospitals.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        {STATES.map((st) => <Link key={st} href={href({ state: st })} className={`rounded px-2 py-1 ${st === state ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>{st === "all" ? "All New England" : st}</Link>)}
        <span className="mx-2 text-stone-300">|</span>
        <Link href={href({ types: all ? undefined : "all" })} className={`rounded px-2 py-1 ${all ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>Include psychiatric & VA</Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="card overflow-hidden">
          <NetworkMap state={state} dots={dots} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-stone-100 px-4 py-2 text-[11px] text-stone-500">
            {carrier ? (
              <>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-emerald-700 align-middle" />In network (inpatient priced)</span>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-amber-600 align-middle" />Outpatient only</span>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-stone-300 align-middle" />Not priced</span>
              </>
            ) : <span>Dot size = number of carriers pricing the hospital. Pick a carrier to see its network.</span>}
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border border-dashed border-stone-500 align-middle" />Unknown (no TIN match)</span>
          </div>
        </div>
        <div className="card divide-y divide-stone-100 text-sm">
          <p className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-stone-500">Network breadth · {state === "all" ? "New England" : state}</p>
          {m.carriers.map((c) => (
            <Link key={c.carrier} href={href({ carrier: c.carrier === carrier ? undefined : c.carrier })} className={`block px-4 py-2 hover:bg-stone-50 ${c.carrier === carrier ? "bg-stone-100" : ""}`}>
              <div className="flex justify-between"><span className="truncate">{short(c.carrierName)}{c.breadth < 0.5 && <span className="ml-1.5 rounded bg-amber-50 px-1 text-[10px] text-amber-800" title="Prices under half the state's general hospitals across all its reduced networks">narrow</span>}</span><span className="tabular-nums font-medium">{Math.round(c.breadth * 100)}%</span></div>
              <div className="mt-1 h-1.5 rounded bg-stone-100"><div className="h-1.5 rounded bg-emerald-700" style={{ width: `${Math.round(c.breadth * 100)}%` }} /></div>
              <p className="mt-0.5 text-[11px] text-stone-500">{c.hospitals} of {m.general} hospitals · {c.inpatient} with inpatient prices</p>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Head to head ── */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Head to head</h2>
        <form action="/networks" className="flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="state" value={state} />
          {all && <input type="hidden" name="types" value="all" />}
          <select name="a" defaultValue={cmpA ?? ""} className="input max-w-xs"><option value="">Carrier A…</option>{m.carriers.map((c) => <option key={c.carrier} value={c.carrier}>{c.carrierName}</option>)}</select>
          <span className="text-stone-400">vs</span>
          <select name="b" defaultValue={cmpB ?? ""} className="input max-w-xs"><option value="">Carrier B…</option>{m.carriers.map((c) => <option key={c.carrier} value={c.carrier}>{c.carrierName}</option>)}</select>
          <button className="btn-ghost">Compare</button>
        </form>
        {cmpA && cmpB && cmpA !== cmpB && (() => {
          const gen = m.hospitals.filter((h) => h.matched && GENERAL.has(h.type));
          const onlyA = gen.filter((h) => h.carriers[cmpA] && !h.carriers[cmpB]);
          const onlyB = gen.filter((h) => h.carriers[cmpB] && !h.carriers[cmpA]);
          const both = gen.filter((h) => h.carriers[cmpA] && h.carriers[cmpB]);
          const nameOf = (c: string) => short(m.carriers.find((x) => x.carrier === c)!.carrierName);
          const List = ({ title, hs, tone }: { title: string; hs: typeof gen; tone: string }) => (
            <div className="card p-4">
              <p className={`font-medium ${tone}`}>{title} <span className="font-normal text-stone-500">({hs.length})</span></p>
              <ul className="mt-2 space-y-0.5 text-xs text-stone-700">{hs.slice(0, 60).map((h) => <li key={h.ccn}>{h.name} <span className="text-stone-400">{h.city}{h.stars ? ` · ${h.stars}★` : ""}{h.type === "Critical Access Hospitals" ? " · critical access" : h.type === "Childrens" ? " · children's" : ""}</span></li>)}</ul>
              {hs.length > 60 && <p className="mt-1 text-xs text-stone-400">+{hs.length - 60} more</p>}
            </div>
          );
          return (
            <>
              <p className="text-sm text-stone-600">
                Of {gen.length} matched general hospitals in {state === "all" ? "New England" : state}: {nameOf(cmpA)} prices {onlyA.length + both.length}, {nameOf(cmpB)} prices {onlyB.length + both.length}; {both.length} overlap.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                <List title={`Only ${nameOf(cmpA)}`} hs={onlyA} tone="text-emerald-800" />
                <List title={`Only ${nameOf(cmpB)}`} hs={onlyB} tone="text-sky-800" />
                <List title="Both" hs={both} tone="text-stone-700" />
              </div>
            </>
          );
        })()}
        {!(cmpA && cmpB) && <p className="text-xs text-stone-500">Pick two carriers to see which hospitals only one of them prices — the network argument a broker will make.</p>}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Hospital × carrier</h2>
          <p className="flex gap-4 text-xs text-stone-500">
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-emerald-700 align-middle" />Inpatient prices</span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-amber-600 align-middle" />Outpatient only</span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border border-stone-300 align-middle" />Not priced</span>
          </p>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Hospital</th>
                {m.carriers.map((c) => <th key={c.carrier} className="px-1.5 py-2 text-center normal-case tracking-normal" title={c.carrierName}><span className="inline-block max-w-[5.5rem] truncate">{short(c.carrierName)}</span></th>)}
                <th className="px-3 py-2 text-right">Carriers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {shown.map((h) => {
                const n = Object.keys(h.carriers).length;
                return (
                  <tr key={h.ccn} className={h.matched ? "" : "text-stone-400"}>
                    <td className="px-3 py-1.5">
                      <span className="font-medium">{h.name}</span>
                      <span className="ml-2 text-[10px] text-stone-400">{h.city}, {h.state} · {h.type.replace(" Hospitals", "")}{h.stars ? ` · ${h.stars}★` : ""}</span>
                    </td>
                    {m.carriers.map((c) => {
                      const p = h.carriers[c.carrier];
                      return <td key={c.carrier} className="px-1.5 py-1.5 text-center" title={p ? (p.inpatient ? "Inpatient priced" : "Outpatient only") : h.matched ? "Not priced" : "Unknown"}>
                        {!h.matched ? "·" : p ? <span className={p.inpatient ? "text-emerald-700" : "text-amber-600"}>●</span> : <span className="text-stone-300">○</span>}
                      </td>;
                    })}
                    <td className="px-3 py-1.5 text-right tabular-nums">{h.matched ? n : "?"}{h.matched && n === 1 ? <span className="ml-1 text-[10px] text-amber-700">only one</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <NotIncluded items={[
        "Network status is inferred: a hospital counts as in a carrier's network when the carrier's reduced rate files price care there. Absent means not priced in those files — usually out of network, but a hospital paid only as a percent of charges or under a carved-out arrangement can also look absent.",
        `${m.unmatched.length} general hospitals in view have no rate-file TIN matched to their Medicare record, so their status is unknown (dashed dots, grey rows)${m.unmatched.length ? `: ${m.unmatched.slice(0, 12).map((h) => h.name).join(", ")}${m.unmatched.length > 12 ? ", …" : ""}` : ""}.`,
        "National carriers (UnitedHealthcare, Cigna national networks, Aetna) are reduced to New England providers already tracked from regional files, so a hospital tracked by no regional carrier can't appear in their networks.",
        "Carriers without rate data (see Rates → What's not included) don't appear here at all; Blue Cross MA shows HMO Blue only.",
        `Hospital list: CMS Hospital General Information (${DIRECTORY_DATE}); locations are ZIP-code centroids, approximate for PO-box ZIPs.`,
      ]} />
    </div>
  );
}
