import { db } from "@/lib/db";
import { checkUrl, HttpError, parseBody, route } from "@/lib/api";
import { sourceCreate } from "@/lib/validators";


export const GET = route("VIEWER", async ({ session }) =>
  db.source.findMany({
    where: { workspaceId: session.workspaceId },
    orderBy: { createdAt: "desc" },
    include: { competitor: { select: { id: true, name: true } }, _count: { select: { signals: true } } },
  }),
);

export const POST = route("ANALYST", async ({ session, req }) => {
  const body = await parseBody(req, sourceCreate);
  await checkUrl(body.url);
  if (body.competitorId) {
    const ok = await db.competitor.count({ where: { id: body.competitorId, workspaceId: session.workspaceId } });
    if (!ok) throw new HttpError(422, "Unknown competitor");
  }
  return db.source.create({ data: { ...body, workspaceId: session.workspaceId } });
});
