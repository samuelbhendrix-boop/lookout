/**
 * Background worker — run as a separate process (`npm run worker`), scale horizontally.
 *  - Scheduler tick: claims due sources and digest rules, enqueues their jobs.
 *  - Job loop: claims queued jobs (SKIP LOCKED) and runs them with retry/backoff.
 */
import { db } from "../lib/db";
import { claimJobs, completeJob, enqueue, failJob, reapStaleJobs } from "../lib/jobs";
import { claimDueSources, pollSource } from "../lib/ingest";
import { claimDueDigests, deliverAlert, sendDigest } from "../lib/alerts";

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 15_000);
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);
let running = true;

async function schedule() {
  const due = await claimDueSources();
  for (const s of due) await enqueue(s.workspaceId, "poll_source", { sourceId: s.id });
  if (due.length) log(`scheduled ${due.length} source poll(s)`);
  const digests = await claimDueDigests();
  for (const d of digests) {
    // First digest covers the past week; later ones cover exactly since the last send.
    const since = d.prev ?? new Date(Date.now() - 7 * 864e5);
    await enqueue(d.workspaceId, "send_digest", { ruleId: d.id, since: new Date(since).toISOString() });
  }
  if (digests.length) log(`scheduled ${digests.length} digest(s)`);
}

async function runJob(job: Awaited<ReturnType<typeof claimJobs>>[number]) {
  const payload = job.payload as Record<string, string>;
  try {
    switch (job.kind) {
      case "poll_source": {
        const n = await pollSource(payload.sourceId);
        log(`poll ${payload.sourceId}: ${n} new`);
        break;
      }
      case "deliver_alert":
        await deliverAlert(payload.ruleId, payload.signalId);
        break;
      case "send_digest":
        await sendDigest(payload.ruleId, payload.since);
        break;
      default:
        throw new Error(`Unknown job kind: ${job.kind}`);
    }
    await completeJob(job.id);
  } catch (err) {
    log(`job ${job.id} (${job.kind}) failed attempt ${job.attempts}: ${(err as Error).message}`);
    await failJob(job, err);
  }
}

async function loop() {
  log(`worker started (tick ${TICK_MS}ms, concurrency ${CONCURRENCY})`);
  let lastReap = 0;
  while (running) {
    try {
      await schedule();
      if (Date.now() - lastReap > 60_000) {
        await reapStaleJobs();
        lastReap = Date.now();
      }
      // Drain the queue in batches before sleeping.
      for (;;) {
        const jobs = await claimJobs(CONCURRENCY);
        if (!jobs.length) break;
        await Promise.all(jobs.map(runJob));
      }
    } catch (err) {
      log(`tick error: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
  await db.$disconnect();
}

function log(msg: string) {
  console.log(`[worker ${new Date().toISOString()}] ${msg}`);
}

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    log(`${sig} received, finishing current batch`);
    running = false;
  });

loop();
