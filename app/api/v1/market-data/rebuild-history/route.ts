import { route } from "@/lib/api";
import { ensureHistoryJob } from "@/lib/marketdata/history";

/** POST /api/v1/market-data/rebuild-history — ADMIN: rebuild rate history (Networks, rate changes) from stored rates. */
export const POST = route("ADMIN", async () => ensureHistoryJob(true));
