import { db } from "@/lib/db";
import { HttpError, route } from "@/lib/api";
import { strategyFor } from "@/lib/strategy";

export const maxDuration = 240;

/** Rewrite one competitor's strategy read now, from the current evidence. */
export const POST = route<{ id: string }>("ANALYST", async ({ session, params }) => {
  const c = await db.competitor.findFirst({ where: { id: params.id, workspaceId: session.workspaceId }, select: { id: true } });
  if (!c) throw new HttpError(404, "Competitor not found");
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(400, "No AI key is set, so the read can't be written");
  const s = await strategyFor(session.workspaceId, c.id, { force: true });
  if (!s) throw new HttpError(502, "The read didn't come back. Try again in a minute.");
  return { ok: true, generatedAt: s.generatedAt };
});
