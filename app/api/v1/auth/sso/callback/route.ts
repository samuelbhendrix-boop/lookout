import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { completeFlow, readFlow, SSO_COOKIE, ssoConfig } from "@/lib/sso";

/** GET /api/v1/auth/sso/callback — finish OIDC, find or provision the user, start a session. */
export async function GET(req: NextRequest) {
  const fail = (msg: string) => {
    const r = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(`SSO: ${msg}`)}`, req.url));
    r.cookies.delete(SSO_COOKIE);
    return r;
  };
  const cfg = ssoConfig();
  if (!cfg) return fail("not configured");
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return fail(sp.get("error_description") ?? sp.get("error")!);
  const flow = readFlow(req.cookies.get(SSO_COOKIE)?.value);
  if (!flow || !sp.get("state") || flow.state !== sp.get("state")) return fail("sign-in expired or was tampered with — try again");
  try {
    const { email, name } = await completeFlow(cfg, sp.get("code") ?? "", flow);
    let user = await db.user.findUnique({ where: { email }, include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } } });
    if (!user) {
      // SSO-only account: random password hash, so password login is impossible until reset by an owner.
      user = await db.user.create({ data: { email, name, passwordHash: await hashPassword(randomBytes(32).toString("hex")) }, include: { memberships: true } });
    }
    let workspaceId = user.memberships[0]?.workspaceId;
    if (!workspaceId) {
      if (!cfg.workspaceId) return fail("your account isn't in a workspace yet — ask an owner to invite you");
      await db.membership.create({ data: { userId: user.id, workspaceId: cfg.workspaceId, role: cfg.role === "OWNER" ? "ADMIN" : cfg.role } });
      workspaceId = cfg.workspaceId;
    }
    await createSession(user.id, workspaceId);
    const r = NextResponse.redirect(new URL(flow.next, req.url));
    r.cookies.delete(SSO_COOKIE);
    return r;
  } catch (e) {
    return fail((e as Error).message);
  }
}
