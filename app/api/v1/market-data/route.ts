import { db } from "@/lib/db";
import { route } from "@/lib/api";
import { allDatasets } from "@/lib/marketdata/discover";

/** Import status for each public dataset. */
export const GET = route("VIEWER", async () => {
  const rows = await db.dataImport.findMany();
  return (await allDatasets()).map((d) => ({ ...d, import: rows.find((r) => r.dataset === d.dataset && r.year === d.year) ?? null }));
});

/** Marks every dataset stale so the worker re-imports them one by one (admin). */
export const POST = route("ADMIN", async () => {
  const { count } = await db.dataImport.updateMany({
    where: { status: { in: ["done", "failed"] } },
    data: { finishedAt: new Date(0), status: "done" },
  });
  return { queued: count };
});
