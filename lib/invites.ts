import { createHash, randomBytes } from "node:crypto";
import type { Prisma, Role } from "@prisma/client";
import { db } from "./db";
import { appUrl } from "./config";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Creates a join link. The raw token is returned once and never stored. */
export async function createInvite(workspaceId: string, createdById: string, role: Role, days = 7, maxUses = 25) {
  const token = randomBytes(24).toString("base64url");
  const invite = await db.invite.create({
    data: { workspaceId, createdById, role, maxUses, tokenHash: sha256(token), expiresAt: new Date(Date.now() + days * 864e5) },
  });
  return { invite, token, url: `${appUrl()}/join/${token}` };
}

/** Looks up a usable invite by raw token (not revoked, not expired, uses left). */
export async function findUsableInvite(token: string) {
  const invite = await db.invite.findUnique({
    where: { tokenHash: sha256(token) },
    include: { workspace: { select: { id: true, name: true } } },
  });
  if (!invite || invite.revokedAt || invite.expiresAt < new Date() || invite.uses >= invite.maxUses) return null;
  return invite;
}

/**
 * Atomically consumes one use and adds the membership. Existing members keep their role
 * (an invite never downgrades or upgrades anyone). Returns the workspace id, or null if
 * the invite became unusable in the meantime.
 */
export async function redeemInvite(tx: Prisma.TransactionClient, token: string, userId: string) {
  const now = new Date();
  const invite = await tx.invite.findUnique({ where: { tokenHash: sha256(token) } });
  if (!invite) return null;
  const consumed = await tx.invite.updateMany({
    where: { id: invite.id, revokedAt: null, expiresAt: { gt: now }, uses: { lt: invite.maxUses } },
    data: { uses: { increment: 1 } },
  });
  if (consumed.count !== 1) return null;
  await tx.membership.upsert({
    where: { userId_workspaceId: { userId, workspaceId: invite.workspaceId } },
    create: { userId, workspaceId: invite.workspaceId, role: invite.role },
    update: {},
  });
  return invite.workspaceId;
}
