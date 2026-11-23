import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { buildPack, packResponse } from "@/lib/pack";

export const dynamic = "force-dynamic";

/** The monthly pack for the signed-in workspace, as an Excel download. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  return packResponse((await buildPack(session.workspaceId)).buffer);
}
