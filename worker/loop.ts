/**
 * Background worker loop. Runs either as its own process (`npm run worker`, scale horizontally)
 * or inside the web process (RUN_WORKER=true, via instrumentation.ts) for single-service deploys.
 *  - Scheduler tick: claims due sources and digest rules, enqueues their jobs.
 *  - Job loop: claims queued jobs (SKIP LOCKED) and runs them with retry/backoff.
 */
import { claimJobs, completeJob, deferJob, enqueue, failJob, IMPORT_HEARTBEAT_MS, reapStaleJobs } from "../lib/jobs";
import { db } from "../lib/db";
import { claimDueSources, DeferJob, pollSource } from "../lib/ingest";
import { claimDueDigests, deliverAlert, sendDigest } from "../lib/alerts";
import { scheduleNextImport } from "../lib/marketdata/import";
import { killImports, runImport } from "../lib/marketdata/run";
import type { Dataset } from "../lib/marketdata/datasets";
import { syncEventsToWorkspaces } from "../lib/marketdata/events";
import { ensureDerivedData } from "../lib/marketdata/history";
import { ensureRecommendedSources } from "../lib/recommended-sources";
import { maybeDiscover } from "../lib/marketdata/discover";
import { applyNewsScope } from "../lib/signals";
let newsScopeApplied = false;

let lastEventSync = 0;
let lastHistoryCheck = 0;

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 15_000);
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);
let running = false;

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
  const imp = await scheduleNextImport((p) => enqueue(null, "import_market_data", p));
  if (imp) log(`scheduled market data import ${imp.dataset} ${imp.year}`);
  // Rate files imported before RateHistory existed have no history; rebuild it from stored rates. Checked every
  // 5 minutes until present, so a deploy that kills the job mid-run doesn't leave the Networks page empty.
  if (Date.now() - lastHistoryCheck > 5 * 60_000) {
    lastHistoryCheck = Date.now();
    for (const r of await ensureDerivedData()) log(r);
    for (const r of await ensureRecommendedSources()) log(r);
    // Once per process: re-sort stored feed stories by each competitor's news scope (cheap when nothing changed).
    if (!newsScopeApplied) { newsScopeApplied = true; try { const r = await applyNewsScope(); if (r.archived || r.restored) log(`news scope: archived ${r.archived} outside New England, restored ${r.restored}`); } catch (e) { log(`news scope failed: ${(e as Error).message}`); } }
    // Weekly: look for new yearly releases (new plan / reporting years, republished files).
    try { const r = await maybeDiscover(); if (r) log(r); } catch (e) { log(`release check failed: ${(e as Error).message}`); }
  }
  // Hourly: turn detected market events into signals for every workspace tracking that carrier.
  if (Date.now() - lastEventSync > 3600e3) {
    lastEventSync = Date.now();
    await enqueue(null, "sync_market_events", {});
  }
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
      case "import_market_data": {
        // Heartbeat: proves this import is alive, so a restart's orphans can be told apart from long imports.
        inFlightImports.add(job.id);
        const beat = setInterval(() => { db.job.update({ where: { id: job.id }, data: { updatedAt: new Date() } }).catch(() => {}); }, IMPORT_HEARTBEAT_MS);
        try {
          log(`import done — ${await runImport(payload.dataset as Dataset, Number(payload.year))}`);
        } finally {
          clearInterval(beat);
          inFlightImports.delete(job.id);
        }
        lastEventSync = 0; // fan out any new events on the next tick
        break;
      }
      case "sync_market_events":
        log(`market events → ${await syncEventsToWorkspaces()} new signal(s)`);
        break;
      default:
        throw new Error(`Unknown job kind: ${job.kind}`);
    }
    await completeJob(job.id);
  } catch (err) {
    if (err instanceof DeferJob) return deferJob(job, err.delayMs);
    log(`job ${job.id} (${job.kind}) failed attempt ${job.attempts}: ${(err as Error).message}`);
    await failJob(job, err);
  }
}

/**
 * Two independent loops so slow work never blocks fast work:
 *  - scheduler: every TICK_MS, enqueue due polls/digests and reap stuck jobs
 *  - dispatcher: keeps up to CONCURRENCY jobs in flight, refilling each slot the moment it frees,
 *    so an alert never waits behind a whole batch of rate-limited feed polls.
 */
const inFlightImports = new Set<string>();

/**
 * On deploy the old server gets SIGTERM. Stop claiming work, stop any import child, and hand its job straight back to
 * the queue so the new server resumes it now rather than after the heartbeat times out.
 */
function onShutdown() {
  if (!running) return;
  running = false;
  killImports();
  const ids = [...inFlightImports];
  if (!ids.length) return;
  log(`shutting down — returning ${ids.length} import job(s) to the queue`);
  void db.job.updateMany({ where: { id: { in: ids }, status: "RUNNING" }, data: { status: "QUEUED", attempts: { decrement: 1 }, lastError: "server restarting (deploy); resumed by the new instance", runAt: new Date() } }).catch(() => {});
}

export async function startWorker() {
  if (running) return;
  running = true;
  process.once("SIGTERM", onShutdown);
  process.once("SIGINT", onShutdown);
  log(`worker started (tick ${TICK_MS}ms, concurrency ${CONCURRENCY})`);
  void schedulerLoop();
  void dispatcherLoop();
}

async function schedulerLoop() {
  let lastReap = 0;
  while (running) {
    try {
      await schedule();
      if (Date.now() - lastReap > 60_000) {
        await reapStaleJobs();
        lastReap = Date.now();
      }
    } catch (err) {
      log(`scheduler error: ${(err as Error).message}`);
    }
    await sleep(TICK_MS);
  }
}

let inFlight = 0;
async function dispatcherLoop() {
  while (running) {
    try {
      const free = CONCURRENCY - inFlight;
      const jobs = free > 0 ? await claimJobs(free) : [];
      for (const job of jobs) {
        inFlight++;
        void runJob(job).finally(() => inFlight--);
      }
      // Busy → check again soon for freed slots; idle → back off.
      await sleep(jobs.length || inFlight >= CONCURRENCY ? 250 : 1000);
    } catch (err) {
      log(`dispatcher error: ${(err as Error).message}`);
      await sleep(5000);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function stopWorker() {
  running = false;
}

function log(msg: string) {
  console.log(`[worker ${new Date().toISOString()}] ${msg}`);
}
