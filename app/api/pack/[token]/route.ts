import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildPack, hashToken, packResponse } from "@/lib/pack";

export const dynamic = "force-dynamic";

/**
 * The monthly pack by private link, for a scheduled fetch that can't sign in. The link is the credential: it is
 * read-only, serves this one workbook and nothing else, and stops working the moment it is revoked or replaced.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = token.length >= 32 ? await db.packLink.findUnique({ where: { tokenHash: hashToken(token) } }) : null;
  if (!link) return NextResponse.json({ error: "This link is not valid. It may have been revoked." }, { status: 404 });
  await db.packLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } });
  return packResponse((await buildPack(link.workspaceId)).buffer);
}
