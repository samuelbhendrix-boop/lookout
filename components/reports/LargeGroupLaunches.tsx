import Link from "next/link";
import { largeGroupLaunches } from "@/lib/reports/lglaunches";
import { CompanyLogo } from "@/components/CompanyLogo";

const KIND: Record<string, { label: string; tone: string; about: string }> = {
  announced: { label: "Announced", tone: "bg-stone-900 text-white", about: "Launch announcement in the news feed" },
  marketed: { label: "New on their site", tone: "bg-emerald-50 text-emerald-800", about: "Product appeared on the carrier's own pages or brochures for the first time" },
  filed: { label: "Filed (SERFF)", tone: "bg-violet-50 text-violet-800", about: "New product in a state filing you added" },
  network: { label: "New network", tone: "bg-sky-50 text-sky-800", about: "Network appeared in the carrier's price-transparency files for the first time" },
};
const NET: Record<string, string> = { limited: "Limited", tiered: "Tiered", "system-anchored": "Health-system", broad: "Broad", national: "National", regional: "Regional", unknown: "" };
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Large-group and self-funded launches: announced, newly marketed, newly published networks; plus today's line-up. */
export async function LargeGroupLaunches({ workspaceId, carrier }: { workspaceId: string; carrier?: string | null }) {
  const { launches, lineup, baselineAt } = await largeGroupLaunches(workspaceId);
  const L = launches.filter((l) => !carrier || l.competitor === carrier);
  const U = lineup.filter((l) => !carrier || l.competitor === carrier);
  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Large-group and self-funded launches</h2>
        <p className="max-w-3xl text-xs text-stone-500">
          Carriers don&apos;t file large-group products with CMS, so there&apos;s no complete list. Three signals stand in: launch announcements in the news feed (last two years), products that appear on a carrier&apos;s own pages for the first time, and networks that appear in its price-transparency files for the first time (a new network usually means a new tiered, limited, health-system or ASO product).
          {baselineAt ? ` Site and network tracking started ${day(baselineAt)}; everything seen then is the baseline, so those two fill in month by month.` : " Site and network tracking starts with the next monthly refresh."}
        </p>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Signal</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">What</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {L.slice(0, 150).map((l, i) => (
                <tr key={`${l.kind}${i}`} className="align-top">
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-stone-500">{day(l.when)}</td>
                  <td className="px-3 py-1.5"><span title={KIND[l.kind].about} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${KIND[l.kind].tone}`}>{KIND[l.kind].label}</span></td>
                  <td className="max-w-[180px] px-3 py-1.5 text-xs">{l.competitorId ? <span className="flex items-center gap-1.5"><CompanyLogo id={l.competitorId} name={l.competitor} size={14} /><Link href={`/competitors/${l.competitorId}/products#marketing`} className="hover:underline">{l.competitor}</Link></span> : l.competitor}</td>
                  <td className="px-3 py-1.5">
                    {l.url ? <a href={l.url} {...(l.url.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })} className="font-medium hover:underline">{l.name}</a> : <span className="font-medium">{l.name}</span>}
                    {l.network && NET[l.network] ? <span className="ml-1.5 rounded bg-stone-100 px-1 text-[10px] text-stone-600">{NET[l.network]} network</span> : null}
                    {l.detail && <div className="text-xs text-stone-500">{l.detail}</div>}
                    {l.evidence?.length ? <div className="text-[11px]">{l.evidence.map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="mr-2 text-sky-700 hover:underline">source</a>)}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!L.length && <p className="px-3 py-3 text-sm text-stone-500">No large-group launch signals yet{carrier ? ` for ${carrier}` : ""}.</p>}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Today&apos;s large-group and self-funded line-up</h2>
        <p className="max-w-3xl text-xs text-stone-500">What each carrier markets to employers now, read from its own pages and brochures (monthly). This is the baseline a launch is measured against. Open a carrier for the pitch, partners and sources.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {U.map((c) => (
            <div key={c.competitorId} className="card p-3">
              <div className="mb-1.5 flex items-center gap-2"><CompanyLogo id={c.competitorId} name={c.competitor} size={18} /><Link href={`/competitors/${c.competitorId}/products#marketing`} className="font-medium hover:underline">{c.competitor}</Link><span className="text-xs text-stone-400">{c.products.length} products</span></div>
              <ul className="space-y-1 text-xs">
                {c.products.map((p) => (
                  <li key={p.name} className="leading-snug">
                    <span className="font-medium">{p.name}</span>
                    {p.planType ? <span className="text-stone-500"> · {p.planType}</span> : null}
                    {NET[p.network] ? <span className={`ml-1 rounded px-1 text-[10px] ${p.network === "limited" ? "bg-amber-50 text-amber-800" : p.network === "tiered" ? "bg-sky-50 text-sky-800" : p.network === "system-anchored" ? "bg-violet-50 text-violet-800" : "bg-stone-100 text-stone-600"}`}>{NET[p.network]}</span> : null}
                    {p.virtualFirst ? <span className="ml-1 rounded bg-emerald-50 px-1 text-[10px] text-emerald-800">Virtual-first</span> : null}
                    {p.funding.length ? <span className="text-stone-400"> · {p.funding.join(", ")}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {!U.length && <p className="text-sm text-stone-500">The carrier product-site read hasn&apos;t run yet.</p>}
      </section>
    </div>
  );
}
