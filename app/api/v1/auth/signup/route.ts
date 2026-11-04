import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { errorResponse, HttpError, parseBody } from "@/lib/api";
import { signupSchema } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";
import { redeemInvite } from "@/lib/invites";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";

/**
 * Two paths:
 *  - inviteToken → user joins that workspace with the invite's role
 *  - otherwise   → user creates their own workspace as OWNER — allowed only for the very first
 *                  account on this instance, or when OPEN_SIGNUP=true (multi-team SaaS mode).
 * A deployed instance is therefore invite-only by default: nobody who finds the URL can sign up.
 */
export async function POST(req: Request) {
  try {
    rateLimit(req, "signup", 5, 60);
    const body = await parseBody(req, signupSchema);
    if (await db.user.findUnique({ where: { email: body.email } }))
      throw new HttpError(409, "An account with that email already exists — sign in instead");

    if (!body.inviteToken && process.env.OPEN_SIGNUP !== "true" && (await db.user.count()) > 0)
      throw new HttpError(403, "Sign-ups are invite-only. Ask a workspace admin for an invite link.");

    const passwordHash = await hashPassword(body.password);
    const { user, workspaceId } = await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: body.email, name: body.name, passwordHash } });
      if (body.inviteToken) {
        const workspaceId = await redeemInvite(tx, body.inviteToken, user.id);
        if (!workspaceId) throw new HttpError(410, "This invite link has expired or been used up");
        return { user, workspaceId };
      }
      const slug = `${slugify(body.workspaceName!)}-${Math.random().toString(36).slice(2, 7)}`;
      const workspace = await tx.workspace.create({ data: { name: body.workspaceName!, slug } });
      await tx.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" } });
      return { user, workspaceId: workspace.id };
    });
    await createSession(user.id, workspaceId);
    return NextResponse.json({ data: { userId: user.id, workspaceId } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
