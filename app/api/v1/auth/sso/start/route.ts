import { NextRequest, NextResponse } from "next/server";
import { discover, newFlow, SSO_COOKIE, ssoConfig } from "@/lib/sso";

/** GET /api/v1/auth/sso/start?next=/feed → redirect to the identity provider. */
export async function GET(req: NextRequest) {
  const cfg = ssoConfig();
  if (!cfg) return NextResponse.redirect(new URL("/login?error=SSO+is+not+configured", req.url));
  const next = req.nextUrl.searchParams.get("next") ?? "/feed";
  const flow = newFlow(next.startsWith("/") && !next.startsWith("//") ? next : "/feed");
  const d = await discover(cfg);
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: cfg.redirectUri, scope: "openid email profile", state: flow.state, nonce: flow.nonce, code_challenge: flow.challenge, code_challenge_method: "S256" }).toString();
  const res = NextResponse.redirect(url);
  res.cookies.set(SSO_COOKIE, flow.cookie, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/v1/auth/sso", maxAge: 600 });
  return res;
}
