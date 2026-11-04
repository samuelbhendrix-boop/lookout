import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Outbound-request guard. Feeds (analyst-supplied) and webhooks (admin-supplied) are
 * user-controlled URLs fetched from inside your network — classic SSRF. Every hop is
 * resolved and rejected if it lands on loopback, private, link-local or metadata ranges.
 * Residual risk: DNS rebinding between check and connect; close it with an egress proxy.
 * Set ALLOW_PRIVATE_URLS=true for local development only.
 */

function ipv4Private(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return ipv4Private(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

export class BlockedUrlError extends Error {}

export async function assertPublicUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedUrlError(`Blocked scheme ${url.protocol}`);
  if (process.env.ALLOW_PRIVATE_URLS === "true") return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal"))
    throw new BlockedUrlError(`Blocked host ${host}`);
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new BlockedUrlError(`Blocked private address for ${host}`);
  return url;
}

const MAX_BYTES = 5 * 1024 * 1024;

/** fetch() that validates every redirect hop and caps the body size. */
export async function safeFetch(raw: string, init: RequestInit = {}, maxRedirects = 3): Promise<{ status: number; ok: boolean; text: string }> {
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...init, redirect: "manual", signal: init.signal ?? AbortSignal.timeout(20_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).toString();
      continue;
    }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new Error(`Response too large (${len} bytes)`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new Error("Response too large");
    return { status: res.status, ok: res.ok, text: new TextDecoder().decode(buf) };
  }
  throw new Error("Too many redirects");
}
