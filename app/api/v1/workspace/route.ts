import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, parseBody, route } from "@/lib/api";
import { iconSchema } from "@/lib/icon";

const body = z.object({ name: z.string().trim().min(2).max(80).optional(), icon: iconSchema.optional(), ownCompetitorId: z.string().cuid().nullable().optional() });

export const GET = route("VIEWER", async ({ session }) => db.workspace.findUnique({ where: { id: session.workspaceId }, select: { id: true, name: true, icon: true, slug: true, ownCompetitorId: true } }));

/** Rename the workspace, change its icon, or set which competitor is "us" (admins). */
export const PATCH = route("ADMIN", async ({ session, req }) => {
  const data = await parseBody(req, body);
  if (data.ownCompetitorId && !(await db.competitor.findFirst({ where: { id: data.ownCompetitorId, workspaceId: session.workspaceId } }))) throw new HttpError(404, "Competitor not found");
  return db.workspace.update({ where: { id: session.workspaceId }, data, select: { id: true, name: true, icon: true, ownCompetitorId: true } });
});
