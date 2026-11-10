import Link from "next/link";
import { DataAsOf } from "@/components/DataAsOf";
import { GENERAL, networkMatrix, DIRECTORY_DATE, systemOf, systemCoverage, carrierNetworks, SYSTEMS_AS_OF } from "@/lib/marketdata/networks";
import { NetworkMapInteractive, type MapHospital } from "@/components/NetworkMapInteractive";
import { neProjection, MAP_W, MAP_H } from "@/lib/marketdata/mapgeo";
import { CompanyLogo } from "@/components/CompanyLogo";
import { db } from "@/lib/db";
import { issuerPatternFor } from "@/lib/marketdata/queries";
import { marketingFor } from "@/lib/marketing/extract";
import { siteFor } from "@/lib/marketing/sites";
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
  const session = (await getSession())!;
  const [comps, nets] = await Promise.all([
    db.competitor.findMany({ where: { workspaceId: session.workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } }),
    carrierNetworks(),
  ]);
  const compOf = (carrierName: string) => comps.find((c) => { try { return new RegExp(issuerPatternFor(c), "i").test(carrierName); } catch { return false; } }) ?? null;
  const { project, outlines } = neProjection();
  const mapHospitals: MapHospital[] = shown.filter((h) => h.lat != null && h.lon != null).flatMap((h) => {
    const p = project(h.lon!, h.lat!);
    if (!p) return [];
    return [{ key: h.ccn, name: h.name, city: h.city, state: h.state, type: h.type, stars: h.stars, system: systemOf(h.name), x: p[0], y: p[1], matched: h.matched, approx: h.approx,
      carriers: Object.fromEntries(Object.entries(h.carriers).map(([k, v]) => [k, v.inpatient ? 2 : 1])) as Record<string, 1 | 2> }];
  });
  const mapCarriers = m.carriers.map((c) => { const comp = compOf(c.carrierName); return { id: c.carrier, name: c.carrierName, short: short(c.carrierName), logo: comp ? `/api/logo/${comp.id}` : null }; });
  const systems = systemCoverage(m);
  const gen = m.hospitals.filter((h) => h.matched && GENERAL.has(h.type));
  // What each carrier markets about its networks (tiered, limited, health-system products), from the product-marketing read.
  const marketedNets = new Map<string, Array<{ name: string; network: string; detail: string | null }>>();
  for (const c of m.carriers) {
    const comp = compOf(c.carrierName);
    const site = comp ? siteFor(comp.name) : null;
    const mk = site && !site.skip ? await marketingFor(site.key, { generate: false }) : null;
    if (mk) marketedNets.set(c.carrier, mk.products.filter((p) => ["tiered", "limited", "system-anchored"].includes(p.network)).map((p) => ({ name: p.name, network: p.network, detail: p.networkDetail ?? null })));
  }
  const href = (o: Record<string, string | undefined>) => `/networks?${new URLSearchParams(Object.entries({ state, carrier, types: all ? "all" : undefined, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const where = state === "all" ? "New England" : state;

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

      <div className="card overflow-hidden">
        <NetworkMapInteractive width={MAP_W} height={MAP_H} states={outlines} focus={state} hospitals={mapHospitals} carriers={mapCarriers} initial={{ carrier, a: cmpA, b: cmpB }} />
      </div>

      {/* ── Carrier networks ── */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Carrier networks · {where}</h2>
        <p className="max-w-3xl text-xs text-stone-500">Each carrier&apos;s hospital breadth here, how many health systems it has fully in network, hospitals only it prices, the networks it publishes rate files for (with provider counts as filed), and the network-based products it markets (tiered, limited, health-system).</p>
        <div className="card overflow-x-auto">
          <table className="w-full text-xs" data-static>
            <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
              <tr><th className="px-3 py-2">Carrier</th><th className="px-3 py-2 text-right">Breadth</th><th className="px-3 py-2 text-right">Hospitals</th><th className="px-3 py-2 text-right">Systems all-in</th><th className="px-3 py-2">Only this carrier</th><th className="px-3 py-2">Published networks</th><th className="px-3 py-2">Marketed network products</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {m.carriers.map((c) => {
                const comp = compOf(c.carrierName);
                const net = nets.get(c.carrier);
                const fullSystems = systems.filter((sy) => sy.matched > 0 && c.carrier in sy.byCarrier && sy.byCarrier[c.carrier] === sy.matched).length;
                const partial = systems.filter((sy) => sy.matched > 0 && sy.byCarrier[c.carrier] > 0 && sy.byCarrier[c.carrier] < sy.matched).length;
                const only = gen.filter((h) => h.carriers[c.carrier] && Object.keys(h.carriers).length === 1);
                const mk = marketedNets.get(c.carrier) ?? [];
                return (
                  <tr key={c.carrier} className="align-top">
                    <td className="max-w-[200px] px-3 py-2">
                      <div className="flex items-center gap-1.5">{comp ? <CompanyLogo id={comp.id} name={comp.name} size={16} /> : null}<Link href={href({ carrier: c.carrier })} className="font-medium hover:underline">{short(c.carrierName)}</Link></div>
                      {net?.lastUpdated && <div className="pl-[22px] text-[10px] text-stone-400">files dated {net.lastUpdated}</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums"><span className="font-medium">{Math.round(c.breadth * 100)}%</span>{c.breadth < 0.5 && <div className="text-[10px] text-amber-700">narrow</div>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.hospitals}<div className="text-[10px] text-stone-400">{c.inpatient} inpatient</div></td>
                    <td className="px-3 py-2 text-right tabular-nums" title={`${partial} more systems partly in network`}>{fullSystems} of {systems.filter((sy) => sy.matched > 0).length}{partial ? <div className="text-[10px] text-stone-400">+{partial} partial</div> : null}</td>
                    <td className="max-w-[200px] px-3 py-2 text-stone-600">{only.length ? only.slice(0, 4).map((h) => h.name.toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase()).replace(/'S\b/g, "'s")).join(", ") + (only.length > 4 ? ` +${only.length - 4}` : "") : <span className="text-stone-300">—</span>}</td>
                    <td className="max-w-[260px] px-3 py-2">{net ? net.networks.filter((n) => !n.duplicate).slice(0, 6).map((n) => <div key={n.name} className="leading-snug">{n.name}{n.providers ? <span className="text-stone-400"> · {n.providers.toLocaleString()} providers</span> : null}</div>) : <span className="text-stone-300">—</span>}{net && net.networks.length > 6 ? <div className="text-stone-400">+{net.networks.length - 6} more</div> : null}</td>
                    <td className="max-w-[260px] px-3 py-2">{mk.length ? mk.slice(0, 4).map((p) => <div key={p.name} className="leading-snug" title={p.detail ?? undefined}><span className={`mr-1 rounded px-1 text-[10px] ${p.network === "limited" ? "bg-amber-50 text-amber-800" : p.network === "tiered" ? "bg-sky-50 text-sky-800" : "bg-violet-50 text-violet-800"}`}>{p.network === "system-anchored" ? "system" : p.network}</span>{p.name}</div>) : <span className="text-stone-300">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Health systems ── */}
      {systems.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">Health systems × carrier · {where}</h2>
          <p className="max-w-3xl text-xs text-stone-500">How many of each health system&apos;s hospitals each carrier prices. A system a carrier has only partly in network is a likely tiering, limited-network or contract-dispute story. Systems by hospital ownership as of {SYSTEMS_AS_OF}.</p>
          <div className="card overflow-x-auto">
            <table className="w-full text-xs" data-static>
              <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
                <tr><th className="px-3 py-2">System</th><th className="px-2 py-2 text-right">Hosp.</th>{m.carriers.map((c) => <th key={c.carrier} className="px-1.5 py-2 text-center normal-case tracking-normal" title={c.carrierName}><span className="inline-block max-w-[5.5rem] truncate">{short(c.carrierName)}</span></th>)}</tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {systems.map((sy) => (
                  <tr key={sy.name}>
                    <td className="px-3 py-1.5 font-medium">{sy.name}<span className="ml-1.5 text-[10px] font-normal text-stone-400">{sy.states.join(" ")}</span></td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{sy.hospitals}{sy.matched < sy.hospitals ? <span className="text-[10px] text-stone-400"> ({sy.hospitals - sy.matched}?)</span> : null}</td>
                    {m.carriers.map((c) => {
                      const n = sy.byCarrier[c.carrier] ?? 0;
                      const full = sy.matched > 0 && n === sy.matched;
                      return <td key={c.carrier} className={`px-1.5 py-1.5 text-center tabular-nums ${full ? "bg-emerald-50 font-medium text-emerald-800" : n > 0 ? "bg-amber-50 text-amber-800" : "text-stone-300"}`} title={`${short(c.carrierName)} prices ${n} of ${sy.matched} matched ${sy.name} hospitals`}>{sy.matched ? (n ? `${n}/${sy.matched}` : "—") : "?"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-stone-400">Green: every matched hospital in the system priced. Amber: some. ? = hospitals whose rate-file tax ID couldn&apos;t be matched.</p>
        </section>
      )}

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
                {m.carriers.map((c) => { const comp = compOf(c.carrierName); return <th key={c.carrier} className="px-1.5 py-2 text-center normal-case tracking-normal" title={c.carrierName}>{comp ? <CompanyLogo id={comp.id} name={comp.name} size={14} className="mx-auto mb-0.5 block" /> : null}<span className="inline-block max-w-[5.5rem] truncate">{short(c.carrierName)}</span></th>; })}
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
                      <span className="ml-2 text-[10px] text-stone-400">{h.city}, {h.state} · {h.type.replace(" Hospitals", "")}{h.stars ? ` · ${h.stars}★` : ""}{systemOf(h.name) ? ` · ${systemOf(h.name)}` : ""}</span>
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
