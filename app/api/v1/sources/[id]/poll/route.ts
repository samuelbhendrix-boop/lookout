import { db } from "@/lib/db";
import { HttpError, route } from "@/lib/api";
import { enqueue } from "@/lib/jobs";

/** Queues an immediate poll. Returns 202 semantics: the worker does the fetch. */
export const POST = route<{ id: string }>("ANALYST", async ({ session, params }) => {
  const s = await db.source.findFirst({ where: { id: params.id, workspaceId: session.workspaceId } });
  if (!s) throw new HttpError(404, "Source not found");
  if (s.kind !== "RSS") throw new HttpError(422, "Only RSS sources can be polled");
  const job = await enqueue(session.workspaceId, "poll_source", { sourceId: s.id });
  return { jobId: job.id };
});
