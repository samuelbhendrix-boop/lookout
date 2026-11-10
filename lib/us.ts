import { db } from "./db";
import { rankCompetitors } from "./homecharts";
import { colorMap, hasColor } from "@/components/viz";

/** The workspace's own carrier ("us"), if one is set and still exists. */
export async function ourCompany(workspaceId: string): Promise<{ id: string; name: string } | null> {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { ownCompetitorId: true } });
  if (!ws?.ownCompetitorId) return null;
  return db.competitor.findFirst({ where: { id: ws.ownCompetitorId, workspaceId }, select: { id: true, name: true } });
}

/** Chart colors for the workspace: "us" in ink, the eight biggest competitors in the categorical palette, the rest gray. */
export async function chartColors(workspaceId: string) {
  const [ranked, us] = await Promise.all([rankCompetitors(workspaceId), ourCompany(workspaceId)]);
  return { ranked, us, color: colorMap(ranked, us?.id), has: (id?: string) => hasColor(ranked, id, us?.id) };
}
