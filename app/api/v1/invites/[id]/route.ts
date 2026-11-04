import { db } from "@/lib/db";
import { HttpError, route } from "@/lib/api";

/** Revoke — link stops working immediately; existing members are unaffected. */
export const DELETE = route<{ id: string }>("ADMIN", async ({ session, params }) => {
  const { count } = await db.invite.updateMany({
    where: { id: params.id, workspaceId: session.workspaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!count) throw new HttpError(404, "Invite not found");
  return null;
});
