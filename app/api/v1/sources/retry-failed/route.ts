import { db } from "@/lib/db";
import { route } from "@/lib/api";
import { enqueue } from "@/lib/jobs";

/** Re-polls every enabled source currently showing an error, spaced out to avoid re-tripping rate limits. */
export const POST = route("ANALYST", async ({ session }) => {
  const failing = await db.source.findMany({
    where: { workspaceId: session.workspaceId, enabled: true, kind: { in: ["RSS", "WEBPAGE"] }, lastError: { not: null } },
    select: { id: true },
  });
  for (const [i, s] of failing.entries())
    await enqueue(session.workspaceId, "poll_source", { sourceId: s.id }, new Date(Date.now() + i * 5000));
  return { queued: failing.length };
});
