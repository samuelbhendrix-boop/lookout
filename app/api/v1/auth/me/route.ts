import { z } from "zod";
import { db } from "@/lib/db";
import { parseBody, route } from "@/lib/api";
import { iconSchema } from "@/lib/icon";

export const GET = route("VIEWER", async ({ session }) => session);

const body = z.object({ name: z.string().trim().max(80).nullable().optional(), icon: iconSchema.optional() });

/** Update your own display name or icon. */
export const PATCH = route("VIEWER", async ({ session, req }) => {
  const { name, icon } = await parseBody(req, body);
  return db.user.update({ where: { id: session.userId }, data: { ...(name !== undefined ? { name: name || null } : {}), ...(icon !== undefined ? { icon } : {}) }, select: { id: true, name: true, icon: true, email: true } });
});
