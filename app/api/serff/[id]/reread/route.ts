import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rereadFiling } from "@/lib/serff/parse";

export const maxDuration = 300;

/** Read a stored filing again from its saved text (no re-upload). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = process.env.INGEST_TOKEN;
  const byToken = !!token && req.headers.get("authorization") === `Bearer ${token}`;
  if (!byToken && !(await getSession())) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await params;
  const ok = await rereadFiling(id);
  return ok ? NextResponse.json({ ok }) : NextResponse.json({ error: "Couldn't read it again (the AI read failed, or the filing was added before its text was kept: upload it once more)." }, { status: 422 });
}
