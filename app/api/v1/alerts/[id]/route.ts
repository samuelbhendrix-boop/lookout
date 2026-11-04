import { db } from "@/lib/db";
import { checkUrl, HttpError, parseBody, route } from "@/lib/api";
import { alertRuleUpdate } from "@/lib/validators";


type P = { id: string };

async function assertOwned(workspaceId: string, id: string) {
  if (!(await db.alertRule.count({ where: { id, workspaceId } }))) throw new HttpError(404, "Alert rule not found");
}

export const PATCH = route<P>("ADMIN", async ({ session, params, req }) => {
  await assertOwned(session.workspaceId, params.id);
  const body = await parseBody(req, alertRuleUpdate);
  await checkUrl(body.webhookUrl);
  if (body.competitorIds) {
    const valid = await db.competitor.findMany({
      where: { id: { in: body.competitorIds }, workspaceId: session.workspaceId },
      select: { id: true },
    });
    body.competitorIds = valid.map((v) => v.id);
  }
  return db.alertRule.update({ where: { id: params.id }, data: body });
});

export const DELETE = route<P>("ADMIN", async ({ session, params }) => {
  await assertOwned(session.workspaceId, params.id);
  await db.alertRule.delete({ where: { id: params.id } });
  return null;
});
