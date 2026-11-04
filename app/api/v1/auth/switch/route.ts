import { db } from "@/lib/db";
import { HttpError, parseBody, route } from "@/lib/api";
import { switchWorkspace } from "@/lib/auth";
import { workspaceSwitch } from "@/lib/validators";

export const POST = route("VIEWER", async ({ session, req }) => {
  const { workspaceId } = await parseBody(req, workspaceSwitch);
  const member = await db.membership.count({ where: { userId: session.userId, workspaceId } });
  if (!member) throw new HttpError(404, "Workspace not found");
  await switchWorkspace(workspaceId);
  return { workspaceId };
});
