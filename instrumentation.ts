/**
 * Next.js startup hook. With RUN_WORKER=true the job worker runs inside the web process, so a
 * single service (e.g. one Render instance) handles pages, API, feed polling and alerts.
 * Jobs are claimed with SKIP LOCKED, so this coexists safely with separate worker processes.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RUN_WORKER === "true") {
    const { startWorker } = await import("./worker/loop");
    void startWorker();
  }
}
