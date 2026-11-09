import { z } from "zod";
import { db } from "@/lib/db";
import { parseBody, route } from "@/lib/api";
import { iconSchema } from "@/lib/icon";

const body = z.object({ name: z.string().trim().min(2).max(80).optional(), icon: iconSchema.optional() });

export const GET = route("VIEWER", async ({ session }) => db.workspace.findUnique({ where: { id: session.workspaceId }, select: { id: true, name: true, icon: true, slug: true } }));

/** Rename the workspace or change its icon (admins). */
export const PATCH = route("ADMIN", async ({ session, req }) => {
  const data = await parseBody(req, body);
  return db.workspace.update({ where: { id: session.workspaceId }, data, select: { id: true, name: true, icon: true } });
});
