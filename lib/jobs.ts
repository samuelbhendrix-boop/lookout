import type { Job, Prisma } from "@prisma/client";
import { db } from "./db";

export type JobKind = "poll_source" | "deliver_alert" | "send_digest" | "import_market_data" | "sync_market_events";

export async function enqueue(
  workspaceId: string | null,
  kind: JobKind,
  payload: Prisma.InputJsonValue,
  runAt = new Date(),
) {
  return db.job.create({ data: { workspaceId, kind, payload, runAt } });
}

/**
 * Atomically claims up to `limit` due jobs, alerts/digests first. FOR UPDATE SKIP LOCKED lets any number of
 * worker replicas pull from the same table without double-processing.
 */
export async function claimJobs(limit = 10): Promise<Job[]> {
  return db.$queryRaw<Job[]>`
    UPDATE "Job" SET status = 'RUNNING', attempts = attempts + 1, "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE id IN (
      SELECT id FROM "Job"
      WHERE status = 'QUEUED' AND "runAt" <= (now() AT TIME ZONE 'UTC')
        -- Imports run one at a time (each can use a few hundred MB): only the oldest due import, and only when no
        -- other import has a live heartbeat.
        AND (kind <> 'import_market_data' OR (
          id = (SELECT id FROM "Job" WHERE kind = 'import_market_data' AND status = 'QUEUED' AND "runAt" <= (now() AT TIME ZONE 'UTC') ORDER BY "runAt", "createdAt" LIMIT 1)
          AND NOT EXISTS (SELECT 1 FROM "Job" r WHERE r.kind = 'import_market_data' AND r.status = 'RUNNING' AND r."updatedAt" > (now() AT TIME ZONE 'UTC') - interval '3 minutes')))
      ORDER BY (kind = 'poll_source'), "runAt" -- alerts and digests jump ahead of feed polls
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING *`;
}

export async function completeJob(id: string) {
  await db.job.update({ where: { id }, data: { status: "DONE", lastError: null } });
}

/** Exponential backoff: 30s, 2m, 8m, 32m… then FAILED. */
export async function failJob(job: Job, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const exhausted = job.attempts >= job.maxAttempts;
  await db.job.update({
    where: { id: job.id },
    data: {
      status: exhausted ? "FAILED" : "QUEUED",
      lastError: message.slice(0, 1000),
      runAt: new Date(Date.now() + 30_000 * 4 ** (job.attempts - 1)),
    },
  });
}

/** Re-queues jobs stuck in RUNNING (worker crashed mid-job). Imports have their own heartbeat-based recovery. */
export async function reapStaleJobs(olderThanMinutes = 10) {
  await recoverOrphanedImports();
  return db.job.updateMany({
    where: { status: "RUNNING", kind: { not: "import_market_data" }, updatedAt: { lt: new Date(Date.now() - olderThanMinutes * 60_000) } },
    data: { status: "QUEUED" },
  });
}

/**
 * Imports run for minutes to hours in a child process, so a running import job touches its row every 30 s. One whose
 * heartbeat has stopped belongs to a server that was replaced (a deploy) or killed (out of memory): it is put back in
 * the queue to resume, or failed with a clear reason once it has been interrupted too many times.
 */
export const IMPORT_HEARTBEAT_MS = 30_000;
const IMPORT_STALE_MS = 3 * 60_000;

export async function liveImportJobs() {
  return db.job.count({
    where: { kind: "import_market_data", OR: [{ status: "QUEUED" }, { status: "RUNNING", updatedAt: { gt: new Date(Date.now() - IMPORT_STALE_MS) } }] },
  });
}

export async function recoverOrphanedImports() {
  const orphans = await db.job.findMany({ where: { kind: "import_market_data", status: "RUNNING", updatedAt: { lt: new Date(Date.now() - IMPORT_STALE_MS) } } });
  for (const j of orphans) {
    const exhausted = j.attempts >= j.maxAttempts;
    const reason = exhausted
      ? `interrupted ${j.attempts} times before finishing — the server is likely running out of memory during this import`
      : "interrupted (the server restarted mid-import, usually a deploy); resumed automatically";
    await db.job.update({ where: { id: j.id }, data: { status: exhausted ? "FAILED" : "QUEUED", lastError: reason, runAt: new Date() } });
    const p = j.payload as { dataset?: string; year?: number | string };
    if (exhausted && p.dataset && p.year != null) {
      await db.dataImport.updateMany({ where: { dataset: p.dataset, year: Number(p.year) }, data: { status: "failed", error: reason, finishedAt: new Date() } });
    }
  }
  return orphans.length;
}

/** Puts a job back without counting the attempt (used when a poll steps aside for rate limiting). */
export async function deferJob(job: Job, delayMs: number) {
  await db.job.update({
    where: { id: job.id },
    data: { status: "QUEUED", attempts: { decrement: 1 }, runAt: new Date(Date.now() + delayMs) },
  });
}
