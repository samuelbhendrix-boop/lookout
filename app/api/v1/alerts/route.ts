import { db } from "@/lib/db";
import { checkUrl, parseBody, route } from "@/lib/api";
import { alertRuleCreate } from "@/lib/validators";


export const GET = route("VIEWER", async ({ session }) =>
  db.alertRule.findMany({ where: { workspaceId: session.workspaceId }, orderBy: { createdAt: "desc" } }),
);

export const POST = route("ADMIN", async ({ session, req }) => {
  const body = await parseBody(req, alertRuleCreate);
  await checkUrl(body.webhookUrl);
  // Drop competitor ids that don't belong to this workspace rather than trusting the client.
  const valid = await db.competitor.findMany({
    where: { id: { in: body.competitorIds }, workspaceId: session.workspaceId },
    select: { id: true },
  });
  return db.alertRule.create({
    data: { ...body, competitorIds: valid.map((v) => v.id), workspaceId: session.workspaceId },
  });
});
