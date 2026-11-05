import type { Job, Prisma } from "@prisma/client";
import { db } from "./db";

export type JobKind = "poll_source" | "deliver_alert" | "send_digest" | "import_market_data";

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

/** Re-queues jobs stuck in RUNNING (worker crashed mid-job). */
export async function reapStaleJobs(olderThanMinutes = 10) {
  return db.job.updateMany({
    // Imports legitimately run long; their staleness is handled by dueImports().
    where: { status: "RUNNING", kind: { not: "import_market_data" }, updatedAt: { lt: new Date(Date.now() - olderThanMinutes * 60_000) } },
    data: { status: "QUEUED" },
  });
}

/** Puts a job back without counting the attempt (used when a poll steps aside for rate limiting). */
export async function deferJob(job: Job, delayMs: number) {
  await db.job.update({
    where: { id: job.id },
    data: { status: "QUEUED", attempts: { decrement: 1 }, runAt: new Date(Date.now() + delayMs) },
  });
}
