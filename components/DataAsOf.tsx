import { db } from "@/lib/db";
import { DATASETS, type Dataset } from "@/lib/marketdata/datasets";

const LABEL: Record<string, string> = {
  urrt: "CMS rate filings", mlr: "CMS loss ratio reports", ma_chia: "MA CHIA enrollment", state_snapshots: "State large-group reports",
  dol_5500: "Form 5500 filings", tic: "Transparency indexes", rates: "Negotiated rate files", qhp: "Exchange plan files",
};
const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * "Data as of" line for a page: for each source the page uses, the latest period on file and when it was last
 * refreshed. Amber when a source hasn't refreshed in 45 days or its last import failed.
 */
export async function DataAsOf({ datasets }: { datasets: Dataset[] }) {
  const rows = await db.dataImport.findMany({ where: { dataset: { in: datasets } } });
  const parts = datasets.map((ds) => {
    const mine = rows.filter((r) => r.dataset === ds);
    const done = mine.filter((r) => r.status === "done" && r.finishedAt && r.finishedAt.getTime() > 0);
    const failed = mine.filter((r) => r.status === "failed");
    const years = DATASETS.filter((d) => d.dataset === ds).map((d) => d.year).filter((y) => y > 1900 && y < 3000);
    const doneYears = done.map((r) => r.year).filter((y) => years.includes(y));
    const period = ds === "rates" ? null : doneYears.length ? Math.max(...doneYears) : null;
    const refreshed = done.length ? new Date(Math.max(...done.map((r) => r.finishedAt!.getTime()))) : null;
    const stale = !refreshed || Date.now() - refreshed.getTime() > 45 * 864e5 || failed.length > 0;
    return { ds, label: LABEL[ds] ?? ds, period, refreshed, stale, failed: failed.length, pending: mine.length < DATASETS.filter((d) => d.dataset === ds).length };
  });
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-500">
      <span className="font-mono uppercase tracking-wide text-stone-400">Data as of</span>
      {parts.map((p) => (
        <span key={p.ds} className={p.stale ? "text-amber-700" : ""} title={p.failed ? `${p.failed} import(s) failed — see System status` : p.pending ? "Some years still importing" : undefined}>
          {p.label}{p.period ? ` ${p.ds === "dol_5500" ? "plan years ≤" : "≤"} ${p.period}` : ""} · {p.refreshed ? `refreshed ${fmt(p.refreshed)}` : "not imported yet"}{p.failed ? " · import failed" : ""}
        </span>
      ))}
    </p>
  );
}
