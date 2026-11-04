import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { errorResponse, HttpError, parseBody } from "@/lib/api";
import { loginSchema } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    rateLimit(req, "login", 10, 60);
    const { email, password } = await parseBody(req, loginSchema);
    const user = await db.user.findUnique({
      where: { email },
      include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
    });
    // Same error for unknown email and wrong password — no account enumeration.
    if (!user || !(await verifyPassword(password, user.passwordHash)))
      throw new HttpError(401, "Invalid email or password");
    const membership = user.memberships[0];
    if (!membership) throw new HttpError(403, "You are not a member of any workspace");
    await createSession(user.id, membership.workspaceId);
    return NextResponse.json({ data: { userId: user.id, workspaceId: membership.workspaceId } });
  } catch (err) {
    return errorResponse(err);
  }
}
