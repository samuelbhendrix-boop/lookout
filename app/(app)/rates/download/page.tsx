import { MRF_TABLES } from "@/lib/mrf-export";

export const dynamic = "force-dynamic";
export const metadata = { title: "Download price data" };

/** Every table the site keeps from payer and hospital price files, each as a download. */
export default async function DownloadPage() {
  const counts = await Promise.all(MRF_TABLES.map((t) => t.count().catch(() => null)));
  const total = counts.reduce<number>((a, c) => a + (c ?? 0), 0);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Download price data</h1>
        <p className="max-w-3xl text-sm text-stone-500">Everything the site has kept from carriers&apos; and hospitals&apos; machine-readable price files, as tables. The site keeps a benchmark set of services for New England providers, not the full files, which run to terabytes.</p>
      </div>
      <section className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h2 className="font-semibold">All tables in one Excel workbook</h2>
          <p className="text-sm text-stone-600">{total.toLocaleString("en-US")} rows across {MRF_TABLES.length} tabs, plus a Read me tab. It is a large file: expect the download to take a minute or two and Excel to open it slowly.</p>
        </div>
        <a href="/api/mrf/all" className="btn">Download workbook</a>
      </section>
      <section className="card divide-y divide-stone-100">
        {MRF_TABLES.map((t, i) => (
          <div key={t.key} className="flex flex-wrap items-start justify-between gap-4 p-5">
            <div className="min-w-0 flex-1 basis-96 space-y-1.5">
              <h2 className="font-semibold">{t.title} <span className="text-sm font-normal text-stone-500">· {counts[i] == null ? "row count unavailable" : `${counts[i]!.toLocaleString("en-US")} rows`}</span></h2>
              <p className="text-sm text-stone-600">{t.holds}</p>
              <p className="text-xs text-stone-500">Source: {t.source}</p>
              <details className="text-xs text-stone-500"><summary className="cursor-pointer">{t.cols.length} columns</summary><p className="mt-1">{t.cols.map((c) => c.h).join(" · ")}</p></details>
            </div>
            <a href={`/api/mrf/${t.key}`} className="btn-ghost shrink-0">Download CSV</a>
          </div>
        ))}
      </section>
      <p className="text-xs text-stone-500">Provider tax IDs are the ones carriers and hospitals publish in their files. Rates are what the files state, not what was paid on any claim.</p>
    </div>
  );
}
