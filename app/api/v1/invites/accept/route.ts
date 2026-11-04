import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, switchWorkspace } from "@/lib/auth";
import { errorResponse, HttpError, parseBody } from "@/lib/api";
import { inviteAccept } from "@/lib/validators";
import { redeemInvite } from "@/lib/invites";

/** Signed-in user joins a workspace via invite and is switched into it. */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) throw new HttpError(401, "Not authenticated");
    const { token } = await parseBody(req, inviteAccept);
    const workspaceId = await db.$transaction((tx) => redeemInvite(tx, token, session.userId));
    if (!workspaceId) throw new HttpError(410, "This invite link has expired or been used up");
    await switchWorkspace(workspaceId);
    return NextResponse.json({ data: { workspaceId } });
  } catch (err) {
    return errorResponse(err);
  }
}
