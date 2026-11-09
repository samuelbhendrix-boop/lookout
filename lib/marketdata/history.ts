import { db } from "../db";
import { enqueue } from "../jobs";

/**
 * RateHistory backfill. Rate files imported before 0.10 have no history, so Networks and rate-change detection stay
 * empty until the next monthly import. This rebuilds it from stored rates (no downloads, ~10 s) as an import job.
 */
const isRefresh = { kind: "import_market_data", payload: { path: ["dataset"], equals: "refresh_index" } } as const;

export async function historyStatus() {
  const [rows, files, job] = await Promise.all([
    db.rateHistory.count(),
    db.rateFile.count({ where: { status: "ok" } }),
    db.job.findFirst({ where: isRefresh, orderBy: { createdAt: "desc" }, select: { status: true, attempts: true, lastError: true, createdAt: true, updatedAt: true } }),
  ]);
  return { rows, files, job };
}

/** Enqueue a rebuild unless one is genuinely in flight. A job left RUNNING by a killed container is failed and replaced. */
export async function ensureHistoryJob(force = false) {
  const { rows, files, job } = await historyStatus();
  if (!files || (rows && !force)) return { queued: false, reason: !files ? "no rate files imported yet" : "history already present" };
  const stale = new Date(Date.now() - 15 * 60_000);
  await db.job.updateMany({ where: { ...isRefresh, status: "RUNNING", updatedAt: { lt: stale } }, data: { status: "FAILED", lastError: "worker restarted while running; replaced" } });
  if (job && (job.status === "QUEUED" || (job.status === "RUNNING" && job.updatedAt >= stale))) return { queued: false, reason: `already ${job.status.toLowerCase()}` };
  await enqueue(null, "import_market_data", { dataset: "refresh_index", year: "0" });
  return { queued: true, reason: "queued" };
}
