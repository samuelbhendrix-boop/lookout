import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { route } from "@/lib/api";

/**
 * GET /api/v1/admin/export — OWNER-only JSON backup of everything this workspace created (competitors, sources,
 * signals with tags and comments, alert rules, members). Public market data isn't included: it's re-importable.
 * Database-level backups are Render's job (point-in-time recovery + logical exports on the paid Postgres plan).
 */
export const GET = route("OWNER", async ({ session }) => {
  const workspaceId = session.workspaceId;
  const [workspace, members, competitors, sources, signals, tags, alertRules] = await Promise.all([
    db.workspace.findUnique({ where: { id: workspaceId } }),
    db.membership.findMany({ where: { workspaceId }, include: { user: { select: { email: true, name: true } } } }),
    db.competitor.findMany({ where: { workspaceId } }),
    db.source.findMany({ where: { workspaceId } }),
    db.signal.findMany({ where: { workspaceId }, include: { tags: true, comments: true } }),
    db.tag.findMany({ where: { workspaceId } }),
    db.alertRule.findMany({ where: { workspaceId } }),
  ]);
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), version: 1, workspace, members, competitors, sources, signals, tags, alertRules });
  const slug = (workspace?.name ?? "workspace").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return new NextResponse(body, {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="payersight-${slug}-${new Date().toISOString().slice(0, 10)}.json"` },
  });
});
