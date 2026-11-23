import { db } from "@/lib/db";
import { SITES } from "@/lib/marketing/sites";
import { CompetitorTabs } from "@/components/CompetitorTabs";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Website changes" };

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const lines = (j: unknown) => (Array.isArray(j) ? j.filter((x): x is string => typeof x === "string") : []);

/** Where carriers reworded their product marketing: each changed page, with the lines added and removed. */
export default async function WebsiteChangesPage() {
  const [versions, reach] = await Promise.all([
    db.productPageVersion.findMany({ where: { replacedAt: { gte: new Date(Date.now() - 365 * 864e5) } }, orderBy: { replacedAt: "desc" }, take: 400, select: { id: true, site: true, url: true, title: true, kind: true, firstSeenAt: true, replacedAt: true, added: true, removed: true } }),
    db.productPage.groupBy({ by: ["kind"], _count: true, _max: { fetchedAt: true } }),
  ]);
  const count = (k: string) => reach.find((r) => r.kind === k)?._count ?? 0;
  const last = reach.map((r) => r._max.fetchedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  const label = (k: string) => SITES.find((s) => s.key === k)?.label ?? k;
  const bySite = new Map<string, typeof versions>();
  for (const v of versions) (bySite.get(v.site) ?? bySite.set(v.site, []).get(v.site)!).push(v);
  return (
    <div className="space-y-5">
      <CompetitorTabs view="changes" sub={`Where carriers reworded their commercial product pages and brochures. Read monthly from their public websites${last ? `; last read ${day(last)}, ${count("html")} pages and ${count("pdf")} documents` : ""}.`} />
      {!versions.length && <Empty title="No wording changes recorded yet">Earlier wording is kept from each monthly read onward, so changes appear here once a page is read a second time and its text has changed.</Empty>}
      {[...bySite].map(([site, vs]) => (
        <section key={site} className="card p-5">
          <h2 className="font-semibold">{label(site)} <span className="text-sm font-normal text-stone-500">· {vs.length} {vs.length === 1 ? "page" : "pages"} reworded</span></h2>
          <div className="mt-3 divide-y divide-stone-100">
            {vs.map((v) => {
              const added = lines(v.added), removed = lines(v.removed);
              return (
                <details key={v.id} className="py-2.5">
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">{v.title || v.url}</span>
                    <span className="text-stone-500"> · changed {day(v.replacedAt)} · {added.length} added, {removed.length} removed{v.kind === "pdf" ? " · document" : ""}</span>
                  </summary>
                  <div className="mt-2 space-y-3 pl-4 text-sm">
                    <a href={v.url} target="_blank" rel="noreferrer" className="break-all text-xs underline">{v.url}</a>
                    {added.length > 0 && <div><div className="text-xs font-semibold text-emerald-800">Added</div><ul className="mt-1 space-y-1">{added.map((l, i) => <li key={i} className="border-l-2 border-emerald-300 pl-2 text-stone-700">{l}</li>)}</ul></div>}
                    {removed.length > 0 && <div><div className="text-xs font-semibold text-stone-600">Removed (wording in place since {day(v.firstSeenAt)})</div><ul className="mt-1 space-y-1">{removed.map((l, i) => <li key={i} className="border-l-2 border-stone-300 pl-2 text-stone-500 line-through decoration-stone-300">{l}</li>)}</ul></div>}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      ))}
      <p className="text-xs text-stone-500">Only public pages on each carrier&apos;s own site are read; broker and employer portals behind a login are not. Lines that only moved, short menu text and lines that differ only in numbers are left out. A page that disappears is not listed.</p>
    </div>
  );
}
