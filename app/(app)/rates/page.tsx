import Link from "next/link";
import { DataAsOf } from "@/components/DataAsOf";
import { BENCH_CODES, codeKey } from "@/lib/marketdata/mrf/codes";
import { DOLLAR_TYPES, SUSPECT, carrierIndex, codeBenchmark, compression, isSuspect, rateFiles, rateGaps, suspectPrices } from "@/lib/marketdata/mrf/queries";
import { MEDICARE_SOURCES } from "@/lib/marketdata/mrf/medicare";
import { db } from "@/lib/db";
import { fmtInt, fmtUsd } from "@/components/charts";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

const CLASS_LABEL: Record<string, string> = { institutional: "Facility", professional: "Professional" };
const gb = (b: number) => (b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
const idxClass = (x: number | null) => (x == null ? "text-stone-400" : x >= 1.05 ? "text-red-700" : x <= 0.95 ? "text-emerald-700" : "text-stone-700");
const pctM = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const idxText = (x: number | null) => x == null ? "—" : `${x >= 1 ? "+" : "−"}${Math.abs((x - 1) * 100).toFixed(0)}%`;

export default async function RatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const files = await rateFiles();
  if (!files.some((f) => f.status === "ok")) {
    return (
      <div className="space-y-5">
        <h1 className="h1">Negotiated rates</h1>
        <DataAsOf datasets={["rates"]} />
        <Empty title="Rate files are loading">Regional carriers&apos; rate files are reduced in the background after deploy (Settings → Market data).</Empty>
      </div>
    );
  }
  const selected = BENCH_CODES.find((c) => codeKey(c.type, c.code) === sp.code) ?? BENCH_CODES.find((c) => c.type === "MS-DRG" && c.code === "470")!;
  const inpatient = selected.type !== "CPT";
  const billingClass = inpatient ? "institutional" : sp.class === "professional" ? "professional" : sp.class === "institutional" ? "institutional" : "professional";
  const STATES = ["MA", "NH", "RI", "ME", "CT", "VT", "all"];
  const state = STATES.includes(sp.state ?? "") ? sp.state! : "MA";
  const [index, bench, gaps] = await Promise.all([carrierIndex(), codeBenchmark(selected.type, selected.code, billingClass, state), rateGaps()]);
  const suspects = await suspectPrices();
  const ok = files.filter((f) => f.status === "ok");
  const shown = bench.carriers;
  const c = compression(ok);
  // MA carriers pay inpatient on APR-DRG; only show MS-DRG chips once a file actually has them.
  const hasMsDrg = (await db.rateSummary.count({ where: { codeType: "MS-DRG", negotiatedType: { in: DOLLAR_TYPES } } })) > 0;
  const categories = [...new Set(BENCH_CODES.map((b) => b.category))];
  const href = (code: string, cls?: string, st = state) => `/rates?code=${encodeURIComponent(code)}${cls ? `&class=${cls}` : ""}&state=${st}`;
  const selKey = codeKey(selected.type, selected.code);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Negotiated rates</h1>
        <DataAsOf datasets={["rates"]} />
          <p className="max-w-3xl text-sm text-stone-500">
            What each carrier actually pays each hospital and provider group, from their federally required rate files.{" "}
            <span className="text-stone-700">{gb(c.compressed)} downloaded → {gb(c.scanned)} scanned in {Math.round(c.seconds)}s → {fmtInt(c.kept)} provider rates kept.</span>
          </p>
        </div>
        <a className="btn-ghost" href={`/api/v1/rates?code=${encodeURIComponent(selKey)}&class=${billingClass}&state=${state}&format=csv`}>Export CSV</a>
      </div>

      {index.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">Price position</h2>
          <p className="text-xs text-stone-500">Same service, same provider, different carrier. Each carrier&apos;s rate vs the cross-carrier average, across every provider priced by 2+ carriers. Unweighted by volume.</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {index.map((x) => (
              <div key={x.carrier} className="card p-4">
                <div className="flex items-baseline justify-between">
                  <p className="font-medium">{x.carrierName}</p>
                  <p className={`text-2xl font-semibold tabular-nums ${idxClass(x.index)}`}>{idxText(x.index)}</p>
                </div>
                <p className="text-xs text-stone-500">vs peers · {fmtInt(x.comparisons)} service × provider comparisons at {fmtInt(x.providers)} providers</p>
                <p className="mb-3 text-xs"><span className="font-medium">{pctM(x.pctMedicare)} of Medicare</span> <span className="text-stone-500">median across {fmtInt(x.pctMedicareN)} priced services</span></p>
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-xs">
                  <span className="font-mono text-[10px] uppercase text-stone-400">Category</span><span className="text-right font-mono text-[10px] uppercase text-stone-400">vs peers</span><span className="text-right font-mono text-[10px] uppercase text-stone-400">% Medicare</span>
                  {x.byCategory.map((b) => (
                    <div key={b.category} className="contents">
                      <span className="text-stone-600">{b.category} <span className="text-stone-400">({b.n})</span></span>
                      <span className={`text-right tabular-nums ${idxClass(b.index)}`}>{idxText(b.index)}</span>
                      <span className="text-right tabular-nums text-stone-700">{pctM(b.pctMedicare)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="card space-y-2 p-3">
          {categories.map((cat) => (
            <div key={cat} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-wide text-stone-400">{cat}</span>
              {BENCH_CODES.filter((b) => b.category === cat && (b.type !== "MS-DRG" || hasMsDrg)).map((b) => {
                const k = codeKey(b.type, b.code);
                return (
                  <Link key={k} href={href(k, sp.class)} className={`rounded-full px-2.5 py-1 ${k === selKey ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`} title={b.label}>
                    {b.label.replace(/\s*\((APR|DRG)[^)]*\)/, "")}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{selected.label}</h2>
            <p className="text-xs text-stone-500">
              {selected.type} {selected.code}
              {inpatient ? " · per admission, median across severity levels 1–4" : ` · ${CLASS_LABEL[billingClass]} rate, no modifiers`}
            </p>
            <p className="text-xs text-stone-600">
              {bench.medicare.amount
                ? <>Medicare (statewide): <span className="font-medium">{fmtUsd(bench.medicare.amount)}</span> <span className="text-stone-400">· {bench.medicare.method}. Hospital rows use that hospital&apos;s own Medicare rate where matched.</span></>
                : <span className="text-amber-700">No Medicare comparison: {(bench.medicare as { reason: string }).reason}.</span>}
            </p>
          </div>
          {!inpatient && (
            <div className="flex gap-1 text-xs">
              {["professional", "institutional"].map((cl) => (
                <Link key={cl} href={href(selKey, cl)} className={`rounded px-2 py-1 ${cl === billingClass ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>{CLASS_LABEL[cl]}</Link>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="mr-1 text-stone-500">Providers in</span>
          {STATES.map((st) => (
            <Link key={st} href={href(selKey, sp.class, st)} className={`rounded px-2 py-1 ${st === state ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>{st === "all" ? "All" : st}</Link>
          ))}
          <span className="ml-2 text-stone-400">State = the matched Medicare hospital&apos;s state, else the tax ID&apos;s IRS prefix. &quot;All&quot; adds providers whose state can&apos;t be determined.</span>
        </div>

        {shown.length === 0 ? (
          <Empty title="No dollar rates for this service and billing class">Try the other billing class — some carriers pay this code only as a percentage of charges.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[11px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Provider</th>
                  {shown.map((c) => (
                    <th key={c.carrier} className="px-3 py-2 text-right align-bottom">
                      <span className="block normal-case tracking-normal text-stone-700">{c.carrierName.replace(/ Health (Plan|Care)$/, "").replace(/Blue Cross and Blue Shield/, "BCBS").replace(/Blue Cross Blue Shield of Massachusetts/, "BCBS MA")}</span>
                      <span className="block normal-case tracking-normal">{c.networks} network{c.networks === 1 ? "" : "s"}</span>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right align-bottom">Medicare</th>
                  <th className="px-3 py-2 text-right align-bottom">High ÷ low</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                <tr className="bg-stone-50 text-xs">
                  <td className="px-3 py-2 text-stone-600">Whole network · median (p25–p75)<span className="block text-stone-400">largest network per carrier, every provider in it</span></td>
                  {shown.map((c) => {
                    const s = c.summary;
                    return (
                      <td key={c.carrier} className="px-3 py-2 text-right tabular-nums" title={s ? `${s.network}` : undefined}>
                        {s ? <><span className="font-medium">{fmtUsd(s.p50)}</span>{bench.medicare.amount ? <span className="ml-1 text-stone-500">{pctM(s.p50 / bench.medicare.amount)}</span> : null}<span className="block text-stone-400">{fmtUsd(s.p25)}–{fmtUsd(s.p75)} · {fmtInt(s.providers)} TINs</span></> : <span className="text-stone-400" title="National file: only New England providers were kept, so there is no network-wide distribution">n/a</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right tabular-nums text-stone-600">{bench.medicare.amount ? fmtUsd(bench.medicare.amount) : "—"}</td>
                  <td />
                </tr>
                {bench.providers.slice(0, 200).map((p) => {
                  const vals = Object.values(p.rates).map((r) => r.median);
                  const lo = Math.min(...vals), hi = Math.max(...vals);
                  return (
                    <tr key={p.tin}>
                      <td className="px-3 py-1.5">
                        <span className="font-medium">{p.name ?? "Unnamed provider"}</span>
                        <span className="ml-2 font-mono text-[10px] text-stone-400">{p.state ?? "?"} · TIN {p.tin}{p.npiCount > 1 ? ` · ${fmtInt(p.npiCount)} NPIs` : ""}</span>
                      </td>
                      {shown.map((c) => {
                        const r = p.rates[c.carrier];
                        const bad = r && isSuspect(r.median, p.medicare.amount);
                        const mark = bad ? "bg-amber-50 text-amber-800 line-through decoration-amber-400" : r && hi > lo * 1.005 ? (r.median === hi ? "text-red-700" : r.median === lo ? "text-emerald-700" : "") : "";
                        const tip = r ? `${bad ? `OUTLIER: ${Math.round((r.median / p.medicare.amount!) * 100)}% of Medicare — likely a bundled case rate or a file error; excluded from the index and % of Medicare.\n` : ""}${r.networks.map((n) => `${n.network}: ${fmtUsd(n.median)} (${n.type})`).join("\n")}\nrange ${fmtUsd(r.min)}–${fmtUsd(r.max)}` : undefined;
                        return (
                          <td key={c.carrier} className={`px-3 py-1.5 text-right tabular-nums ${mark}`} title={tip}>
                            {r ? <>{fmtUsd(r.median)}{r.prev && Math.abs(r.median / r.prev - 1) >= 0.005 ? <span className={`ml-1 text-[10px] ${r.median > r.prev ? "text-red-600" : "text-emerald-700"}`} title={`Last month ${fmtUsd(r.prev)}`}>{r.median > r.prev ? "▲" : "▼"}{Math.abs((r.median / r.prev - 1) * 100).toFixed(0)}%</span> : null}{p.medicare.amount ? <span className="block text-[10px] text-stone-400">{pctM(r.median / p.medicare.amount)}{r.networks.length > 1 ? ` · ${r.networks.length} nets` : ""}</span> : null}</> : <span className="text-stone-300">—</span>}
                          </td>
                        );
                      })}
                      <td className="px-3 py-1.5 text-right text-xs tabular-nums text-stone-500" title={p.medicare.amount ? p.medicare.method : (p.medicare as { reason: string }).reason}>
                        {p.medicare.amount ? <>{fmtUsd(p.medicare.amount)}{p.medicare.hospital ? <span className="block text-[10px] text-stone-400">hospital-specific</span> : null}</> : <span className="text-stone-300">n/a</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs tabular-nums text-stone-500">{p.spread && p.spread > 1.005 ? `${p.spread.toFixed(2)}×` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-4 py-3 text-[11px] text-stone-400">
              Provider detail is kept for hospitals (anyone billing inpatient DRGs), each carrier&apos;s largest groups, and every provider tracked from another carrier; the network row covers every provider in the file.
              Dollar rates only (negotiated, fee schedule, derived); percent-of-charge contracts are excluded. Where a carrier has several networks, the cell is the median across them — hover for each network&apos;s rate. Small % = share of Medicare. Showing up to 200 providers ({fmtInt(bench.providers.length)} in view).
            </p>
          </div>
        )}
      </section>

      <section className="space-y-2" id="not-included">
        <h2 className="text-lg font-semibold tracking-tight">What&apos;s not included</h2>
        <p className="text-xs text-stone-500">Everything this benchmark leaves out, and why. Counts update with each monthly run.</p>
        <div className="card divide-y divide-stone-100 text-xs">
          <Gap title={`Carriers without rate data (${gaps.carriersNotCovered.length})`}>
            {gaps.carriersNotCovered.map((c) => <li key={c.carrier}><span className="font-medium">{c.carrier}</span> — {c.reason}</li>)}
          </Gap>
          <Gap title={`Files found but not reduced (${gaps.skippedFiles.reduce((s, x) => s + x.files, 0)})`}>
            {gaps.skippedFiles.map((x, i) => <li key={i}><span className="font-medium">{x.carrier}</span>: {x.files} file{x.files === 1 ? "" : "s"} — {x.reason}</li>)}
            {gaps.duplicates.length > 0 && <li>{gaps.duplicates.length} networks were identical to another network of the same carrier and are counted once ({Object.entries(gaps.duplicates.reduce((m, d) => ((m[d.carrier] = (m[d.carrier] ?? 0) + 1), m), {} as Record<string, number>)).map(([c, n]) => `${c}: ${n}`).join("; ")}).</li>}
            {gaps.stale.length > 0 && <li className="text-amber-800">{gaps.stale.length} offline snapshot{gaps.stale.length === 1 ? " is" : "s are"} more than 45 days old and couldn&apos;t be refreshed automatically ({[...new Set(gaps.stale.map((x) => x.carrier))].join(", ")}; oldest {gaps.stale.map((x) => x.lastUpdated).sort()[0]}). Prices shown are from that month.</li>}
            {gaps.failed.map((x, i) => <li key={`f${i}`} className="text-red-700"><span className="font-medium">{x.carrier} · {x.network}</span> failed this month: {x.error}</li>)}
          </Gap>
          <Gap title={`Whole categories a carrier doesn't publish in dollars (${gaps.missingCategories.length})`}>
            {gaps.missingCategories.map((m) => <li key={m}>{m}. Usually these are paid as a percent of charges or per diem, or simply absent from the carrier&apos;s file.</li>)}
          </Gap>
          <Gap title="Prices dropped inside the files we did reduce (totals per carrier)">
            {Object.entries(gaps.perFile.reduce((m, f) => {
              const c = f.file.split(" · ")[0];
              const x = m[c] ?? (m[c] = { networks: 0, snapshot: false, codes: 0, mods: 0, expired: 0, pct: 0, perDiem: 0, small: 0 });
              x.networks++; x.snapshot ||= f.snapshot; x.codes = Math.max(x.codes, f.codesOutsideBasket ?? 0); x.mods += f.modifierPrices ?? 0; x.expired += f.expiredPrices ?? 0;
              x.pct = Math.max(x.pct, f.percentOfChargeProviders); x.perDiem = Math.max(x.perDiem, f.perDiemProviders); x.small = Math.max(x.small, f.providersSummaryOnly ?? 0);
              return m;
            }, {} as Record<string, { networks: number; snapshot: boolean; codes: number; mods: number; expired: number; pct: number; perDiem: number; small: number }>)).map(([c, x]) => (
              <li key={c}>
                <span className="font-medium">{c}</span> ({x.networks} network{x.networks === 1 ? "" : "s"}{x.snapshot ? ", reduced offline" : ""}): ~{fmtInt(x.codes)} billing codes outside the basket; {fmtInt(x.mods)} modifier-priced and {fmtInt(x.expired)} expired prices dropped;
                {" "}up to {fmtInt(x.pct)} providers on percent-of-charge and {fmtInt(x.perDiem)} on per-diem terms excluded from dollar comparisons; up to {fmtInt(x.small)} smaller providers only in the network distribution.
              </li>
            ))}
            <li>National files (UnitedHealthcare, Cigna national networks, Aetna) keep only New England providers already tracked from regional files and have no network-wide distribution.</li>
          </Gap>
          <Gap title={`Outlier prices (${suspects.reduce((t, x) => t + x.count, 0)} provider × service prices excluded)`}>
            <li>Prices above {SUSPECT.high}× or below {SUSPECT.low}× the provider&apos;s Medicare rate are excluded from the price index and % of Medicare and shown struck through. Most are bundled case rates filed under a single code (e.g. a hip replacement priced with the facility fee included) or errors in the carrier&apos;s file (e.g. one hospital at ~$260K for every DRG) — either way they aren&apos;t like-for-like.</li>
            {suspects.map((x) => <li key={x.carrierName}><span className="font-medium">{x.carrierName}</span>: {x.count} — e.g. {x.examples.join("; ")}</li>)}
          </Gap>
          <Gap title={`Cross-carrier comparisons (${fmtInt(gaps.singleCarrierCells)} of ${fmtInt(gaps.totalCells)} provider × service prices excluded)`}>
            <li>The price index only uses services priced at the same provider by 2+ carriers; prices seen at one carrier only still appear in tables and in % of Medicare.</li>
            <li>The index weights every service equally — it does not reflect each carrier&apos;s actual utilization mix.</li>
          </Gap>
          <Gap title={`Medicare comparisons not available (${gaps.noMedicare.length} service/billing combinations, ${gaps.unmatchedHospitals.length} hospitals)`}>
            {gaps.noMedicare.map((m, i) => <li key={i}><span className="font-medium">{m.service}</span> ({CLASS_LABEL[m.billingClass] ?? m.billingClass}) — {m.reason}</li>)}
            {gaps.unmatchedHospitals.length > 40 && <li className="text-stone-500">Showing 40 of {gaps.unmatchedHospitals.length} — the full list is in the CSV export of any inpatient service (Medicare method column).</li>}
            {gaps.unmatchedHospitals.slice(0, 40).map((h) => <li key={h.tin}><span className="font-medium">{h.name ?? "Unnamed provider"}</span> <span className="font-mono text-stone-400">TIN {h.tin}</span> — {h.reason}</li>)}
            <li>Medicare inpatient amounts exclude outlier payments and use CMS&apos;s modeled FY2027 factors; APR-DRGs (no Medicare equivalent) are compared to the matching MS-DRG family&apos;s average weight, so treat inpatient % of Medicare as approximate.</li>
            <li>Professional Medicare amounts average the Boston and rest-of-Massachusetts localities (they differ ~5%); non-Massachusetts providers use the same Massachusetts figure.</li>
          </Gap>
        </div>
        <p className="text-[11px] text-stone-400">Medicare sources: {MEDICARE_SOURCES.map((x, i) => <span key={i}>{i ? " · " : ""}<a className="underline" href={x.url} target="_blank" rel="noopener noreferrer">{x.name}</a></span>)}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Files</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
              <tr><th className="px-3 py-2">Carrier · network</th><th className="px-3 py-2">File date</th><th className="px-3 py-2 text-right">Download</th><th className="px-3 py-2 text-right">Scanned</th><th className="px-3 py-2 text-right">Seconds</th><th className="px-3 py-2 text-right">Providers</th><th className="px-3 py-2 text-right">Rows kept</th><th className="px-3 py-2">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {files.filter((f) => !["skipped", "cursor", "cache"].includes(f.status)).sort((a, b) => a.carrierName.localeCompare(b.carrierName) || a.network.localeCompare(b.network)).map((f) => {
                const s = (f.stats ?? {}) as Record<string, number>;
                return (
                  <tr key={f.id}>
                    <td className="px-3 py-1.5">{f.url ? <a className="underline decoration-stone-300" href={f.url} target="_blank" rel="noopener noreferrer">{f.carrierName}</a> : f.carrierName} · {f.network}</td>
                    <td className="px-3 py-1.5">{f.lastUpdated ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.compressedBytes ? gb(s.compressedBytes) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.bytes ? gb(s.bytes) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.seconds ? Math.round(s.seconds) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(s.providers)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt((s.rows ?? 0) || null)}</td>
                    <td className={`px-3 py-1.5 ${f.status === "ok" ? "text-emerald-700" : "text-red-600"}`} title={f.error ?? undefined}>
                      {s.snapshot ? "snapshot" : f.status}{f.processedAt && !s.snapshot ? ` · ${f.processedAt.toISOString().slice(0, 10)}` : ""}
                      {s.snapshot ? <span className="block text-stone-400">reduced offline; NE providers only</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-stone-500">
          Refreshed monthly. National carriers&apos; files (UnitedHealthcare, Cigna, Aetna: 10–100+ GB each) are reduced the same way with <code className="rounded bg-stone-100 px-1">npm run mrf:reduce</code> on a larger machine. See <Link className="underline" href="/transparency">Transparency files</Link>.
        </p>
      </section>
    </div>
  );
}

function Gap({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group px-4 py-2.5">
      <summary className="cursor-pointer font-medium text-stone-700">{title}</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-stone-600">{children}</ul>
    </details>
  );
}
