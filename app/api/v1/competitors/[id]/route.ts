import { db } from "@/lib/db";
import { HttpError, parseBody, route } from "@/lib/api";
import { competitorUpdate } from "@/lib/validators";
import { validatePattern } from "@/lib/marketdata/queries";

type P = { id: string };

// Every lookup is scoped by workspaceId — a foreign id simply 404s.
async function find(workspaceId: string, id: string) {
  const c = await db.competitor.findFirst({ where: { id, workspaceId } });
  if (!c) throw new HttpError(404, "Competitor not found");
  return c;
}

export const GET = route<P>("VIEWER", async ({ session, params }) => {
  await find(session.workspaceId, params.id);
  return db.competitor.findUnique({
    where: { id: params.id },
    include: { sources: true, _count: { select: { signals: true } } },
  });
});

export const PATCH = route<P>("ANALYST", async ({ session, params, req }) => {
  await find(session.workspaceId, params.id);
  const body = await parseBody(req, competitorUpdate);
  if (body.issuerPattern) {
    const err = validatePattern(body.issuerPattern);
    if (err) throw new HttpError(422, err);
  }
  if (body.issuerPattern === "") body.issuerPattern = null;
  return db.competitor.update({ where: { id: params.id }, data: body });
});

export const DELETE = route<P>("ADMIN", async ({ session, params }) => {
  await find(session.workspaceId, params.id);
  await db.competitor.delete({ where: { id: params.id } });
  return null;
});
