import Link from "next/link";
import { BENCH_CODES, codeKey } from "@/lib/marketdata/mrf/codes";
import { DOLLAR_TYPES, carrierIndex, codeBenchmark, compression, rateFiles } from "@/lib/marketdata/mrf/queries";
import { db } from "@/lib/db";
import { fmtInt, fmtUsd } from "@/components/charts";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

const CLASS_LABEL: Record<string, string> = { institutional: "Facility", professional: "Professional" };
const gb = (b: number) => (b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
const idxClass = (x: number) => (x >= 1.05 ? "text-red-700" : x <= 0.95 ? "text-emerald-700" : "text-stone-700");
const idxText = (x: number) => `${x >= 1 ? "+" : "−"}${Math.abs((x - 1) * 100).toFixed(0)}%`;

export default async function RatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const files = await rateFiles();
  if (!files.some((f) => f.status === "ok")) {
    return (
      <div className="space-y-5">
        <h1 className="h1">Negotiated rates</h1>
        <Empty title="Rate files are loading">Regional carriers&apos; rate files are reduced in the background after deploy (Settings → Market data).</Empty>
      </div>
    );
  }
  const selected = BENCH_CODES.find((c) => codeKey(c.type, c.code) === sp.code) ?? BENCH_CODES.find((c) => c.type === "APR-DRG" && c.code === "302")!;
  const inpatient = selected.type !== "CPT";
  const billingClass = inpatient ? "institutional" : sp.class === "professional" ? "professional" : sp.class === "institutional" ? "institutional" : "professional";
  const [index, bench] = await Promise.all([carrierIndex(), codeBenchmark(selected.type, selected.code, billingClass)]);
  const ok = files.filter((f) => f.status === "ok");
  const shown = ok.filter((f) => bench.summary.has(f.id) || bench.providers.some((p) => p.rates[f.id]));
  const c = compression(ok);
  // MA carriers pay inpatient on APR-DRG; only show MS-DRG chips once a file actually has them.
  const hasMsDrg = (await db.rateSummary.count({ where: { codeType: "MS-DRG", negotiatedType: { in: DOLLAR_TYPES } } })) > 0;
  const categories = [...new Set(BENCH_CODES.map((b) => b.category))];
  const href = (code: string, cls?: string) => `/rates?code=${encodeURIComponent(code)}${cls ? `&class=${cls}` : ""}`;
  const selKey = codeKey(selected.type, selected.code);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Negotiated rates</h1>
          <p className="max-w-3xl text-sm text-stone-500">
            What each carrier actually pays each hospital and provider group, from their federally required rate files.{" "}
            <span className="text-stone-700">{gb(c.compressed)} downloaded → {gb(c.scanned)} scanned in {Math.round(c.seconds)}s → {fmtInt(c.kept)} provider rates kept.</span>
          </p>
        </div>
        <a className="btn-ghost" href={`/api/v1/rates?code=${encodeURIComponent(selKey)}&class=${billingClass}&format=csv`}>Export CSV</a>
      </div>

      {index.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">Price position</h2>
          <p className="text-xs text-stone-500">Same service, same provider, different carrier. Each carrier&apos;s rate vs the cross-carrier average, across every provider priced by 2+ carriers. Unweighted by volume.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {index.map((x) => (
              <div key={x.carrier} className="card p-4">
                <div className="flex items-baseline justify-between">
                  <p className="font-medium">{x.carrierName}</p>
                  <p className={`text-2xl font-semibold tabular-nums ${idxClass(x.index)}`}>{idxText(x.index)}</p>
                </div>
                <p className="mb-3 text-xs text-stone-500">vs peers · {fmtInt(x.comparisons)} service × provider comparisons at {fmtInt(x.providers)} providers</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  {x.byCategory.map((b) => (
                    <div key={b.category} className="flex justify-between">
                      <span className="text-stone-600">{b.category}</span>
                      <span className={`tabular-nums ${idxClass(b.index)}`}>{idxText(b.index)} <span className="text-stone-400">({b.n})</span></span>
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
          </div>
          {!inpatient && (
            <div className="flex gap-1 text-xs">
              {["professional", "institutional"].map((cl) => (
                <Link key={cl} href={href(selKey, cl)} className={`rounded px-2 py-1 ${cl === billingClass ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`}>{CLASS_LABEL[cl]}</Link>
              ))}
            </div>
          )}
        </div>

        {shown.length === 0 ? (
          <Empty title="No dollar rates for this service and billing class">Try the other billing class — some carriers pay this code only as a percentage of charges.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left font-mono text-[11px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Provider</th>
                  {shown.map((f) => (
                    <th key={f.id} className="px-3 py-2 text-right">
                      <span className="block normal-case tracking-normal text-stone-700">{f.carrierName.replace(/ Health (Plan|Care)$/, "")}</span>
                      <span className="block normal-case tracking-normal">{f.network.replace(/\s*\(.*\)$/, "")}</span>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">High ÷ low</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                <tr className="bg-stone-50 text-xs">
                  <td className="px-3 py-2 text-stone-600">Whole network · median (p25–p75)</td>
                  {shown.map((f) => {
                    const s = bench.summary.get(f.id);
                    return (
                      <td key={f.id} className="px-3 py-2 text-right tabular-nums">
                        {s ? <><span className="font-medium">{fmtUsd(s.p50)}</span><span className="block text-stone-400">{fmtUsd(s.p25)}–{fmtUsd(s.p75)} · {fmtInt(s.providers)} TINs</span></> : "—"}
                      </td>
                    );
                  })}
                  <td />
                </tr>
                {bench.providers.slice(0, 150).map((p) => {
                  const vals = Object.values(p.rates).map((r) => r.median);
                  const lo = Math.min(...vals), hi = Math.max(...vals);
                  return (
                    <tr key={p.tin}>
                      <td className="px-3 py-1.5">
                        <span className="font-medium">{p.name ?? "Unnamed provider"}</span>
                        <span className="ml-2 font-mono text-[10px] text-stone-400">TIN {p.tin}{p.npiCount > 1 ? ` · ${fmtInt(p.npiCount)} NPIs` : ""}</span>
                      </td>
                      {shown.map((f) => {
                        const r = p.rates[f.id];
                        const mark = r && hi > lo * 1.005 ? (r.median === hi ? "text-red-700" : r.median === lo ? "text-emerald-700" : "") : "";
                        return (
                          <td key={f.id} className={`px-3 py-1.5 text-right tabular-nums ${mark}`} title={r ? `${r.negotiatedType}; range ${fmtUsd(r.min)}–${fmtUsd(r.max)}` : undefined}>
                            {r ? fmtUsd(r.median) : <span className="text-stone-300">—</span>}
                          </td>
                        );
                      })}
                      <td className="px-3 py-1.5 text-right text-xs tabular-nums text-stone-500">{p.spread && p.spread > 1.005 ? `${p.spread.toFixed(2)}×` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-4 py-3 text-[11px] text-stone-400">
              Provider detail is kept for hospitals (anyone billing inpatient DRGs), each carrier&apos;s largest groups, and every provider tracked from another carrier; the network row covers every provider in the file.
              Dollar rates only (negotiated, fee schedule, derived); percent-of-charge contracts are excluded. Hover a rate for its type and range. Showing up to 150 providers.
            </p>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Files</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
              <tr><th className="px-3 py-2">Carrier · network</th><th className="px-3 py-2">File date</th><th className="px-3 py-2 text-right">Download</th><th className="px-3 py-2 text-right">Scanned</th><th className="px-3 py-2 text-right">Seconds</th><th className="px-3 py-2 text-right">Providers</th><th className="px-3 py-2 text-right">Rows kept</th><th className="px-3 py-2">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {files.map((f) => {
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
