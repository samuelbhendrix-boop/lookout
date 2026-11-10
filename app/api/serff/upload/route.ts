import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ingestFiling, KEEP, type UploadedFile } from "@/lib/serff/parse";

export const maxDuration = 300;

/**
 * Upload one or more SERFF filings: the files of each filing's folder (main PDF + attachments). Files are grouped by
 * their top folder, so several filing folders can go up at once. Attachments we don't use are dropped on the client.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const form = await req.formData();
  const groups = new Map<string, UploadedFile[]>();
  for (const [, v] of form.entries()) {
    if (typeof v === "string") continue;
    const name = (v as File).name;
    if (!KEEP(name)) continue;
    // A filing's folder: everything before an "… Attachments" folder, else the file's own folder.
    const parts = name.split("/").slice(0, -1);
    const cut = parts.findIndex((p) => /attachments$/i.test(p));
    const key = (cut >= 0 ? parts.slice(0, cut) : parts).join("/") || "_";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push({ name, data: Buffer.from(await (v as File).arrayBuffer()) });
  }
  if (!groups.size) return NextResponse.json({ error: "No filing files in the upload (expected the SERFF PDF and its attachments)." }, { status: 400 });
  const results: Array<{ folder: string; ok: boolean; tracking?: string; id?: string; access?: number; crosswalk?: number; error?: string }> = [];
  for (const [folder, files] of groups) {
    try { const r = await ingestFiling(files, session.email); results.push({ folder, ok: true, ...r }); }
    catch (e) { results.push({ folder, ok: false, error: (e as Error).message }); }
  }
  return NextResponse.json({ results });
}
