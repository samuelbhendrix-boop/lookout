import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

/** Save a Data table view (name + query string) for the workspace. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { name?: string; query?: string } | null;
  const name = body?.name?.trim().slice(0, 120), query = body?.query?.slice(0, 4000);
  if (!name || query == null) return NextResponse.json({ error: "A name and a view are required" }, { status: 400 });
  const row = await db.savedPull.create({ data: { workspaceId: session.workspaceId, name, query, createdBy: session.userId }, select: { id: true, name: true, query: true } });
  return NextResponse.json(row);
}
