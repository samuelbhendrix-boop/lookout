import Link from "next/link";
import { db } from "@/lib/db";
import { extractInfo, services } from "@/lib/marketdata/mrfx";
import { NE_STATES } from "@/lib/marketdata/products";
import { NotIncluded } from "@/components/NotIncluded";
import { Empty } from "@/components/ui";
import { PricingTabs } from "@/components/PricingTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Prices · explore a code" };

const SETTINGS = {
  pro: { label: "Physician services", codeType: "CPT", billingClass: "professional", note: "What the carrier pays physician groups and other professionals (CPT/HCPCS, no modifier)." },
  op: { label: "Hospital outpatient", codeType: "CPT", billingClass: "institutional", note: "Facility fee for outpatient services (CPT/HCPCS billed by a hospital or facility)." },
  ip: { label: "Inpatient stays", codeType: "MS-DRG", billingClass: "institutional", note: "Case rate per inpatient stay (MS-DRG)." },
} as const;
type Setting = keyof typeof SETTINGS;
const usd = (n: number | null | undefined) => (n == null ? "—" : n >= 10000 ? `$${(n / 1000).toFixed(1)}K` : `$${n >= 100 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2)}`);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const short = (n: string) => n.replace(/ (Health Plan|Health Care|Healthcare|Insurance Company|Blue Cross and Blue Shield|Blue Cross Blue Shield)\b.*/i, "").replace(/^Anthem$/, "Anthem").slice(0, 22);

export default async function RateExplorer({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const state = NE_STATES.includes(sp.state ?? "") ? sp.state! : "MA";
  const setting: Setting = sp.s === "op" || sp.s === "ip" ? sp.s : "pro";
  const S = SETTINGS[setting];
  const q = (sp.q ?? "").trim();
  const info = await extractInfo();
  const qs = (o: Record<string, string | undefined>) => `/rates/explore?${new URLSearchParams(Object.entries({ state, s: setting, q: q || undefined, code: sp.code, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const chip = (on: boolean) => `rounded px-2.5 py-1 ${on ? "bg-stone-900 text-white" : "bg-stone-100 hover:bg-stone-200"}`;

  const catalog = services().filter((x) => x.type === S.codeType);
  const shown = (q ? catalog.filter((x) => x.code.toLowerCase() === q.toLowerCase() || x.description.toLowerCase().includes(q.toLowerCase()) || x.code.toLowerCase().startsWith(q.toLowerCase())) : catalog).slice(0, q ? 60 : 30);
  const rows = info ? await db.marketCodeRate.findMany({ where: { state, codeType: S.codeType, billingClass: S.billingClass, code: { in: shown.map((x) => x.code) } } }) : [];
  const carriers = [...new Set(rows.map((r) => r.carrierName))].sort();

  // Price index: for every service at least 3 carriers price in this state and setting, each carrier's median ÷ the
  // median of all carriers' medians; the index is the median of those ratios.
  const all = info ? await db.marketCodeRate.findMany({ where: { state, codeType: S.codeType, billingClass: S.billingClass }, select: { carrierName: true, code: true, median: true, providers: true } }) : [];
  const byCode = new Map<string, Array<{ c: string; m: number }>>();
  for (const r of all) (byCode.get(r.code) ?? byCode.set(r.code, []).get(r.code)!).push({ c: r.carrierName, m: r.median });
  const ratios = new Map<string, number[]>();
  for (const xs of byCode.values()) {
    if (xs.length < 3) continue;
    const mid = median(xs.map((x) => x.m))!;
    for (const x of xs) (ratios.get(x.c) ?? ratios.set(x.c, []).get(x.c)!).push(x.m / mid);
  }
  const index = [...ratios.entries()].map(([c, r]) => ({ carrier: c, index: median(r)!, codes: r.length, providers: Math.max(...all.filter((x) => x.carrierName === c).map((x) => x.providers)) })).filter((x) => x.codes >= 10).sort((a, b) => a.index - b.index);

  const one = sp.code ? catalog.find((x) => x.code === sp.code) : null;
  const detail = one ? await db.marketCodeRate.findMany({ where: { codeType: S.codeType, billingClass: S.billingClass, code: one.code }, orderBy: [{ state: "asc" }, { median: "asc" }] }) : [];

  return (
    <div className="space-y-6">
      <PricingTabs view="explore" state={state} />
      <div>
        <p className="max-w-3xl text-sm text-stone-500">
          What each carrier pays New England providers for {services().length.toLocaleString()} services (the top physician services by Medicare spend and
          every DRG), from every carrier rate file we can reach, extracted monthly.{" "}
          {info ? <>Extract {info.month} · {info.files} files · <a className="underline" href={info.url}>download the full data</a>.</> : null}
        </p>
      </div>

      {!info ? (
        <Empty title="The monthly extract hasn't been published yet">
          It runs free in GitHub Actions on the 4th of each month (repo → Actions → &quot;MRF extract (monthly)&quot; → Run workflow) and appears here within a day.
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {NE_STATES.map((s) => <Link key={s} href={qs({ state: s })} className={chip(state === s)}>{s}</Link>)}
            <span className="mx-2 text-stone-300">|</span>
            {(Object.keys(SETTINGS) as Setting[]).map((k) => <Link key={k} href={qs({ s: k, code: undefined, q: undefined })} className={chip(setting === k)}>{SETTINGS[k].label}</Link>)}
            <form className="ml-auto flex gap-1" action="/rates/explore">
              <input type="hidden" name="state" value={state} /><input type="hidden" name="s" value={setting} />
              <input name="q" defaultValue={q} placeholder={setting === "ip" ? "DRG or e.g. sepsis" : "Code or e.g. MRI, colonoscopy"} className="input w-56 py-1 text-xs" />
              <button className="btn-ghost py-1 text-xs">Search</button>
            </form>
          </div>
          <p className="text-xs text-stone-500">{S.note} Median across providers in {state}; each provider group counts once.</p>

          {index.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-semibold tracking-tight">Price index · {state} · {S.label.toLowerCase()}</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {index.map((x) => (
                  <div key={x.carrier} className="card p-3">
                    <p className="truncate text-sm font-medium" title={x.carrier}>{x.carrier}</p>
                    <p className={`text-xl font-semibold tabular-nums ${x.index < 0.97 ? "text-emerald-700" : x.index > 1.03 ? "text-red-600" : ""}`}>{(x.index * 100).toFixed(0)}</p>
                    <p className="text-[11px] text-stone-500">{x.codes} services compared</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-stone-500">100 = the typical carrier. Below 100 pays providers less (a cost advantage); above pays more. Services at least three carriers price in {state}.</p>
            </section>
          )}

          {one && (
            <section className="space-y-2">
              <h2 className="font-semibold tracking-tight">{one.code} · {one.description}</h2>
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">State</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2 text-right">Low (25th)</th><th className="px-3 py-2 text-right">Median</th><th className="px-3 py-2 text-right">High (75th)</th><th className="px-3 py-2 text-right">Providers</th></tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {detail.map((r) => <tr key={r.id}><td className="px-3 py-1.5">{r.state}</td><td className="px-3 py-1.5">{r.carrierName}</td><td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{usd(r.p25)}</td><td className="px-3 py-1.5 text-right font-medium tabular-nums">{usd(r.median)}</td><td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{usd(r.p75)}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.providers.toLocaleString()}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="font-semibold tracking-tight">{q ? `Services matching “${q}”` : `Top ${shown.length} ${S.label.toLowerCase()} by Medicare spend`} · {state}</h2>
            {!rows.length ? <Empty title="No rates for these services here">Try another state, setting or search.</Empty> : (
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Service</th>{carriers.map((c) => <th key={c} className="px-2 py-2 text-right normal-case" title={c}>{short(c)}</th>)}</tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {shown.map((svc) => {
                      const cells = carriers.map((c) => rows.find((r) => r.code === svc.code && r.carrierName === c) ?? null);
                      const priced = cells.filter((x): x is NonNullable<typeof x> => !!x);
                      if (!priced.length) return null;
                      const mid = median(priced.map((x) => x.median))!;
                      return (
                        <tr key={svc.code}>
                          <td className="max-w-[300px] px-3 py-1.5"><Link href={qs({ code: svc.code })} className="font-mono text-xs font-medium hover:underline">{svc.code}</Link> <span className="text-xs text-stone-600" title={svc.description}>{svc.description.slice(0, 60)}</span></td>
                          {cells.map((x, i) => {
                            const d = x ? x.median / mid - 1 : null;
                            return <td key={carriers[i]} className={`px-2 py-1.5 text-right tabular-nums ${d == null || priced.length < 3 ? "" : d <= -0.1 ? "text-emerald-700" : d >= 0.1 ? "text-red-600" : ""}`} title={x ? `${x.providers} providers · ${usd(x.p25)}–${usd(x.p75)}` : undefined}>{x ? usd(x.median) : <span className="text-stone-300">—</span>}</td>;
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-stone-500">Green: 10%+ below the other carriers&apos; median for that service; red: 10%+ above. Hover for the provider count and the middle-half range. Click a code for every state.</p>
          </section>

          <NotIncluded items={[
            <>Dollar prices only. Percent-of-charges and per-diem contracts can&apos;t be compared on a per-service basis and are in the downloadable data, not these medians.</>,
            <>About 2,500 services: the top 1,800 physician services by Medicare spend (97% of it) and every DRG. Rarely billed codes are left out to keep the extract free to run.</>,
            <>Carriers whose files only a browser can reach (BCBSMA HMO Blue, WellSense) are missing unless someone adds them by hand; see the manual-file guide.</>,
            ...(info.failed.length ? [<>Not extracted this month: {info.failed.map((f) => `${f.carrierName ?? "?"} ${f.network ?? ""}`).join("; ")}.</>] : []),
          ]} />
        </>
      )}
    </div>
  );
}
