import { db } from "@/lib/db";
import { logoDomain } from "@/lib/logos";

/** A competitor's stored site icon. 404 when there isn't one (the page shows initials instead). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await db.competitor.findUnique({ where: { id }, select: { name: true, website: true } });
  const d = c ? logoDomain(c) : null;
  const l = d ? await db.siteLogo.findUnique({ where: { domain: d } }) : null;
  if (!l || l.contentType === "none" || !l.data.length) return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=3600" } });
  return new Response(new Uint8Array(l.data), { headers: { "content-type": l.contentType, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff", ...(l.contentType === "image/svg+xml" ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } : {}) } });
}
