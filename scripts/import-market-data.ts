/**
 * Manual import: `npm run market:import [urrt|mlr] [year]` — no args imports everything due.
 * The worker does this automatically; this is for local development and debugging.
 */
import { importDataset, dueImports } from "../lib/marketdata/import";
import { DATASETS } from "../lib/marketdata/datasets";
import { db } from "../lib/db";

(async () => {
  const [ds, yr] = process.argv.slice(2);
  const list = ds ? DATASETS.filter((d) => d.dataset === ds && (!yr || d.year === Number(yr))) : await dueImports();
  for (const d of list) {
    const t = Date.now();
    const rows = await importDataset(d.dataset, d.year);
    const mem = Math.round(process.memoryUsage().rss / 1e6);
    console.log(`${d.dataset} ${d.year}: ${rows} rows in ${Math.round((Date.now() - t) / 1000)}s (rss ${mem} MB)`);
  }
  await db.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
