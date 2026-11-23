import { NextResponse } from "next/server";
import { getSession, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashToken, newToken } from "@/lib/pack";

/** Make the workspace's private pack link (replacing any earlier one). The link is returned once and only its hash is kept. */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!hasRole(session.role, "ADMIN")) return NextResponse.json({ error: "Only a workspace admin can make the private link" }, { status: 403 });
  const token = newToken();
  const data = { tokenHash: hashToken(token), createdBy: session.userId, createdAt: new Date(), lastUsedAt: null };
  await db.packLink.upsert({ where: { workspaceId: session.workspaceId }, create: { workspaceId: session.workspaceId, ...data }, update: data });
  return NextResponse.json({ path: `/api/pack/${token}` });
}

/** Revoke the private link. */
export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!hasRole(session.role, "ADMIN")) return NextResponse.json({ error: "Only a workspace admin can revoke the private link" }, { status: 403 });
  await db.packLink.deleteMany({ where: { workspaceId: session.workspaceId } });
  return NextResponse.json({ ok: true });
}
