import { db } from "@/lib/db";
import { checkUrl, HttpError, parseBody, route } from "@/lib/api";
import { sourceUpdate } from "@/lib/validators";


type P = { id: string };

async function find(workspaceId: string, id: string) {
  const s = await db.source.findFirst({ where: { id, workspaceId } });
  if (!s) throw new HttpError(404, "Source not found");
  return s;
}

export const PATCH = route<P>("ANALYST", async ({ session, params, req }) => {
  await find(session.workspaceId, params.id);
  const body = await parseBody(req, sourceUpdate);
  await checkUrl(body.url);
  if (body.competitorId) {
    const ok = await db.competitor.count({ where: { id: body.competitorId, workspaceId: session.workspaceId } });
    if (!ok) throw new HttpError(422, "Unknown competitor");
  }
  return db.source.update({ where: { id: params.id }, data: body });
});

export const DELETE = route<P>("ADMIN", async ({ session, params }) => {
  await find(session.workspaceId, params.id);
  await db.source.delete({ where: { id: params.id } });
  return null;
});
