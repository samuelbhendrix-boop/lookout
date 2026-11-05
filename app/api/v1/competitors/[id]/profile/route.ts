import { db } from "@/lib/db";
import { HttpError, route } from "@/lib/api";
import { competitorProfile } from "@/lib/marketdata/queries";

/** GET ?state=MA — performance by segment/year, products & plans, rate filings, matched entities. */
export const GET = route<{ id: string }>("VIEWER", async ({ session, params, req }) => {
  const comp = await db.competitor.findFirst({ where: { id: params.id, workspaceId: session.workspaceId } });
  if (!comp) throw new HttpError(404, "Competitor not found");
  const state = new URL(req.url).searchParams.get("state") ?? undefined;
  return competitorProfile(comp, state?.toUpperCase());
});
