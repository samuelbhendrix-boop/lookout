import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, parseBody, route } from "@/lib/api";
import { hashPassword, SESSION_COOKIE, verifyPassword } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

const body = z.object({ current: z.string().min(1).max(200), next: z.string().min(10, "Use at least 10 characters").max(200) });

/** Change your password; signs out your other sessions. */
export const POST = route("VIEWER", async ({ session, req }) => {
  rateLimit(req, "password", 5, 60);
  const { current, next } = await parseBody(req, body);
  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId } });
  if (!(await verifyPassword(current, user.passwordHash))) throw new HttpError(422, "Current password is wrong");
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const mine = createHash("sha256").update(token).digest("hex");
  const { count } = await db.session.deleteMany({ where: { userId: user.id, tokenHash: { not: mine } } });
  return { ok: true, signedOutOthers: count };
});
