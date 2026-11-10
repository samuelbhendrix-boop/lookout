import { redirect } from "next/navigation";
import { getSession, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActionButton } from "@/components/ActionButton";
import { snapshotVersion } from "@/lib/marketdata/import";
import pkg from "@/package.json";
import { readFileSync } from "node:fs";

/** Container memory from cgroups (v2, then v1): what the hosting plan actually allows, and what's in use. */
function containerMemory() {
  const read = (p: string) => { try { return readFileSync(p, "utf8").trim(); } catch { return null; } };
  const limit = read("/sys/fs/cgroup/memory.max") ?? read("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  const used = read("/sys/fs/cgroup/memory.current") ?? read("/sys/fs/cgroup/memory/memory.usage_in_bytes");
  const n = (x: string | null) => (x && /^\d+$/.test(x) && Number(x) < 2 ** 50 ? Number(x) : null);
  return { limit: n(limit), used: n(used) };
}

export const dynamic = "force-dynamic";

/** One screen that says what the system is doing and what's stuck — the thing to screenshot when a page is empty. */
export default async function StatusPage() {
  const session = (await getSession())!;
  if (!hasRole(session.role, "ADMIN")) redirect("/briefing");
  const stale = new Date(Date.now() - 15 * 60_000);
  const hospitalFiles = await db.hospitalFile.findMany({ orderBy: [{ status: "asc" }, { domain: "asc" }], select: { domain: true, hospital: true, status: true, rows: true, error: true, lastUpdated: true } });
  const [jobs, stuck, failed, imports, months, events, rateFiles, lastJob] = await Promise.all([
    db.job.groupBy({ by: ["kind", "status"], _count: true }),
    db.job.findMany({ where: { status: "RUNNING", updatedAt: { lt: stale } }, orderBy: { updatedAt: "asc" }, take: 20 }),
    db.job.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 8 }),
    db.dataImport.findMany({ orderBy: [{ dataset: "asc" }, { year: "asc" }] }),
    db.rateHistory.groupBy({ by: ["month"], _count: true, orderBy: { month: "asc" } }),
    db.marketEvent.groupBy({ by: ["kind"], _count: true, _max: { createdAt: true } }),
    db.rateFile.groupBy({ by: ["status"], _count: true }),
    db.job.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true, kind: true } }),
  ]);
  const idleMin = lastJob ? Math.round((Date.now() - lastJob.updatedAt.getTime()) / 60_000) : null;
  const kinds = [...new Set(jobs.map((j) => j.kind))].sort();
  const count = (k: string, s: string) => jobs.find((j) => j.kind === k && j.status === s)?._count ?? 0;
  const mem = process.memoryUsage();
  const box = containerMemory();
  const live = await db.job.findMany({ where: { kind: "import_market_data", status: "RUNNING", updatedAt: { gte: new Date(Date.now() - 3 * 60_000) } }, select: { payload: true, createdAt: true, updatedAt: true, attempts: true } });
  const H = ({ children }: { children: React.ReactNode }) => <h2 className="font-mono text-xs uppercase tracking-wide text-stone-500">{children}</h2>;
  const bad = imports.filter((i) => i.status === "failed");
  return (
    <div className="space-y-5 text-sm">
      <div>
        <h1 className="h1">System status</h1>
        <p className="text-stone-500">Payersight {pkg.version} · web process {Math.round(mem.rss / 1e6)} MB{box.limit ? <> · server memory <span className={box.used && box.used / box.limit > 0.85 ? "font-medium text-red-700" : ""}>{box.used ? `${Math.round(box.used / 1e6)} of ` : ""}{Math.round(box.limit / 1e6)} MB</span>{box.limit < 1e9 ? " (512 MB plan: imports may not fit next to the web server)" : ""}</> : null} · snapshots {snapshotVersion().split("#")[1]} · {new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Worker", idleMin == null ? "never ran" : idleMin <= 5 ? "running" : `idle ${idleMin} min`, idleMin == null || idleMin > 30],
          ["Stuck jobs", String(stuck.length), stuck.length > 0],
          ["Failed imports", String(bad.length), bad.length > 0],
          ["Rate history", months.length ? `${months.length} month${months.length === 1 ? "" : "s"}` : "none", months.length === 0],
        ].map(([label, value, warn]) => (
          <div key={String(label)} className={`card px-4 py-3 ${warn ? "border-red-300 bg-red-50" : ""}`}><p className="font-mono text-[10px] uppercase tracking-wide text-stone-500">{label}</p><p className="mt-1 text-lg font-medium">{value}</p></div>
        ))}
      </div>

      {live.length > 0 && (
        <div className="card p-4">
          <p className="font-medium">Importing now</p>
          <ul className="mt-1 font-mono text-xs">{live.map((j, i) => <li key={i}>{JSON.stringify(j.payload)} · started {j.createdAt.toISOString().slice(11, 16)} UTC · last heartbeat {Math.round((Date.now() - j.updatedAt.getTime()) / 1000)}s ago · attempt {j.attempts}</li>)}</ul>
        </div>
      )}
      <H>Jobs</H>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Kind</th>{["QUEUED", "RUNNING", "DONE", "FAILED"].map((s) => <th key={s} className="px-3 py-2 text-right">{s.toLowerCase()}</th>)}</tr></thead>
          <tbody className="divide-y divide-stone-100">{kinds.map((k) => <tr key={k}><td className="px-3 py-1.5">{k}</td>{["QUEUED", "RUNNING", "DONE", "FAILED"].map((s) => <td key={s} className={`px-3 py-1.5 text-right tabular-nums ${s === "FAILED" && count(k, s) ? "text-red-700" : ""}`}>{count(k, s).toLocaleString()}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {stuck.length > 0 && (
        <div className="card p-4">
          <p className="font-medium text-red-800">Marked running, but no heartbeat for over 15 minutes</p>
          <ul className="mt-2 space-y-1 font-mono text-xs">{stuck.map((j) => <li key={j.id}>{j.kind} {JSON.stringify(j.payload)} · since {j.updatedAt.toISOString().slice(0, 16)} · attempt {j.attempts}</li>)}</ul>
          <p className="mt-2 text-xs text-stone-500">The server that ran these was replaced (a deploy) or killed. Imports are re-queued automatically within 3 minutes; after 5 interruptions an import is marked failed with the reason.</p>
        </div>
      )}
      {failed.length > 0 && (
        <>
          <H>Latest failed jobs</H>
          <ul className="card divide-y divide-stone-100 font-mono text-xs">{failed.map((j) => <li key={j.id} className="px-4 py-2">{j.updatedAt.toISOString().slice(0, 16)} · {j.kind} {JSON.stringify(j.payload).slice(0, 80)} — <span className="text-red-700">{j.lastError?.slice(0, 220)}</span></li>)}</ul>
        </>
      )}

      <H>Data</H>
      <div className="card space-y-2 p-4">
        <p>Rate files: {rateFiles.map((r) => `${r._count} ${r.status}`).join(" · ") || "none"}</p>
        <p>Rate history: {months.map((m) => `${m.month} (${m._count.toLocaleString()})`).join(" · ") || "none"} <span className="ml-2"><ActionButton method="POST" path="/market-data/rebuild-history" doneText="Queued">Rebuild now</ActionButton></span></p>
        <p>Hospital price files: {hospitalFiles.length ? ["ok", "skipped", "failed"].map((st) => `${hospitalFiles.filter((f) => f.status === st).length} ${st}`).join(" · ") : "not imported yet"}</p>
        {hospitalFiles.some((f) => f.status !== "ok") && (
          <details className="text-xs"><summary className="cursor-pointer text-stone-500">Hospitals not read</summary>
            <ul className="mt-1 space-y-0.5">{hospitalFiles.filter((f) => f.status !== "ok").map((f, i) => <li key={i}>{f.hospital} <span className="text-stone-400">({f.domain})</span> — {f.error}</li>)}</ul>
          </details>
        )}
        <p>Detected changes: {events.map((e) => `${e.kind.replace("_", " ")} ${e._count.toLocaleString()}`).join(" · ") || "none"}</p>
      </div>

      <H>Imports</H>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Dataset</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Rows</th><th className="px-3 py-2">Finished</th><th className="px-3 py-2">Error</th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {imports.map((i) => (
              <tr key={i.id}><td className="px-3 py-1.5">{i.dataset} {i.year}</td><td className={`px-3 py-1.5 ${i.status === "failed" ? "text-red-700" : ""}`}>{i.status}</td><td className="px-3 py-1.5 text-right tabular-nums">{i.rows.toLocaleString()}</td><td className="px-3 py-1.5 font-mono text-xs">{i.finishedAt?.toISOString().slice(0, 16) ?? "—"}</td><td className="px-3 py-1.5 text-xs text-red-700">{i.status === "failed" ? i.error?.slice(0, 160) : ""}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
