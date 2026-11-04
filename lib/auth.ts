import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { db } from "./db";

export const SESSION_COOKIE = "lk_session";
const SESSION_TTL_DAYS = 30;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

/** Creates a DB-backed session and sets the httpOnly cookie. */
export async function createSession(userId: string, workspaceId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 864e5);
  await db.session.create({ data: { tokenHash: sha256(token), userId, workspaceId, expiresAt } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export type SessionContext = {
  userId: string;
  email: string;
  name: string | null;
  workspaceId: string;
  workspaceName: string;
  role: Role;
};

/** Resolves the current session + membership. Null if missing, expired, or membership revoked. */
export async function getSession(): Promise<SessionContext | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  const membership = await db.membership.findUnique({
    where: { userId_workspaceId: { userId: session.userId, workspaceId: session.workspaceId } },
    include: { workspace: true },
  });
  if (!membership) return null;
  return {
    userId: session.userId,
    email: session.user.email,
    name: session.user.name,
    workspaceId: membership.workspaceId,
    workspaceName: membership.workspace.name,
    role: membership.role,
  };
}

const RANK: Record<Role, number> = { VIEWER: 0, ANALYST: 1, ADMIN: 2, OWNER: 3 };
export const hasRole = (actual: Role, min: Role) => RANK[actual] >= RANK[min];

/** Points the current session at another workspace. Caller must have verified membership. */
export async function switchWorkspace(workspaceId: string) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return;
  await db.session.update({ where: { tokenHash: sha256(token) }, data: { workspaceId } });
}
