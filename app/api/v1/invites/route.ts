import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseBody, route } from "@/lib/api";
import { inviteCreate } from "@/lib/validators";
import { createInvite } from "@/lib/invites";

/** Active invites (token is never returned after creation). */
export const GET = route("ADMIN", async ({ session }) =>
  db.invite.findMany({
    where: { workspaceId: session.workspaceId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, role: true, uses: true, maxUses: true, expiresAt: true, createdAt: true, createdBy: { select: { email: true } } },
  }),
);

/** Returns the join URL once. Admins can only mint roles up to ADMIN (never OWNER). */
export const POST = route("ADMIN", async ({ session, req }) => {
  const body = await parseBody(req, inviteCreate);
  const { invite, url } = await createInvite(session.workspaceId, session.userId, body.role, body.days, body.maxUses);
  return NextResponse.json({ data: { id: invite.id, url, role: invite.role, expiresAt: invite.expiresAt } }, { status: 201 });
});
