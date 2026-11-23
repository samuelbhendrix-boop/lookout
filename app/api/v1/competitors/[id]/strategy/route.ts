import { db } from "@/lib/db";
import { HttpError, route } from "@/lib/api";
import { startStrategy } from "@/lib/strategy";

/** Start rewriting one competitor's strategy read from the current evidence. It runs in the background and takes about a minute. */
export const POST = route<{ id: string }>("ANALYST", async ({ session, params }) => {
  const c = await db.competitor.findFirst({ where: { id: params.id, workspaceId: session.workspaceId }, select: { id: true } });
  if (!c) throw new HttpError(404, "Competitor not found");
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(400, "No AI key is set, so the read can't be written");
  startStrategy(session.workspaceId, c.id);
  return { ok: true, started: true };
});
