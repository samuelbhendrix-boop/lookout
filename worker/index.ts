/** Standalone worker process: `npm run worker`. */
import { startWorker, stopWorker } from "./loop";
import { db } from "../lib/db";

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    console.log(`[worker] ${sig} received, finishing current batch`);
    stopWorker();
    setTimeout(() => db.$disconnect().then(() => process.exit(0)), 1000);
  });

startWorker();
