import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { appUrl } from "./config";

/**
 * Single sign-on via OpenID Connect (authorization code + PKCE). Works with Microsoft Entra ID, Google Workspace,
 * Okta — anything that publishes /.well-known/openid-configuration. Enabled when OIDC_ISSUER, OIDC_CLIENT_ID and
 * OIDC_CLIENT_SECRET are set. New users from OIDC_ALLOWED_DOMAINS join OIDC_WORKSPACE_ID as OIDC_DEFAULT_ROLE (VIEWER by default; never OWNER).
 */
export function ssoConfig() {
  const issuer = process.env.OIDC_ISSUER?.replace(/\/$/, "");
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret) return null;
  const role = (process.env.OIDC_DEFAULT_ROLE ?? "VIEWER").toUpperCase();
  return {
    issuer, clientId, clientSecret,
    label: process.env.OIDC_LABEL ?? "Sign in with SSO",
    domains: (process.env.OIDC_ALLOWED_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean),
    workspaceId: process.env.OIDC_WORKSPACE_ID || null,
    role: (["OWNER", "ADMIN", "ANALYST", "VIEWER"].includes(role) ? role : "VIEWER") as "OWNER" | "ADMIN" | "ANALYST" | "VIEWER",
    redirectUri: `${appUrl()}/api/v1/auth/sso/callback`,
  };
}
export type SsoConfig = NonNullable<ReturnType<typeof ssoConfig>>;

type Discovery = { authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string };
let discovered: { at: number; doc: Discovery } | null = null;
export async function discover(cfg: SsoConfig): Promise<Discovery> {
  if (discovered && Date.now() - discovered.at < 3600e3) return discovered.doc;
  const res = await fetch(`${cfg.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
  const doc = (await res.json()) as Discovery;
  discovered = { at: Date.now(), doc };
  return doc;
}

export const SSO_COOKIE = "lk_sso";
const b64 = (b: Buffer) => b.toString("base64url");

/** Fresh state / nonce / PKCE verifier; the cookie value is checked on callback. */
export function newFlow(next: string) {
  const state = b64(randomBytes(24)), nonce = b64(randomBytes(24)), verifier = b64(randomBytes(48));
  const challenge = b64(createHash("sha256").update(verifier).digest());
  return { state, nonce, verifier, challenge, cookie: b64(Buffer.from(JSON.stringify({ state, nonce, verifier, next }))) };
}
export function readFlow(cookie: string | undefined) {
  try {
    return cookie ? (JSON.parse(Buffer.from(cookie, "base64url").toString("utf8")) as { state: string; nonce: string; verifier: string; next: string }) : null;
  } catch {
    return null;
  }
}

/** Exchange the code and verify the ID token (signature via JWKS, issuer, audience, expiry, nonce). Returns the email. */
export async function completeFlow(cfg: SsoConfig, code: string, flow: { nonce: string; verifier: string }) {
  const d = await discover(cfg);
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, client_id: cfg.clientId, client_secret: cfg.clientSecret, code_verifier: flow.verifier }),
    signal: AbortSignal.timeout(15_000),
  });
  const tok = (await res.json()) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !tok.id_token) throw new Error(tok.error_description ?? tok.error ?? `token exchange failed (HTTP ${res.status})`);
  const { payload } = await jwtVerify(tok.id_token, createRemoteJWKSet(new URL(d.jwks_uri)), { issuer: d.issuer, audience: cfg.clientId });
  if (payload.nonce !== flow.nonce) throw new Error("nonce mismatch");
  if (payload.email_verified === false) throw new Error("email not verified by the identity provider");
  const email = String(payload.email ?? payload.preferred_username ?? "").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("identity provider returned no email");
  const domain = email.split("@")[1];
  if (cfg.domains.length && !cfg.domains.includes(domain)) throw new Error(`${domain} isn't an allowed sign-in domain`);
  return { email, name: typeof payload.name === "string" ? payload.name : null };
}
