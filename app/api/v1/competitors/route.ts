import { db } from "@/lib/db";
import { parseBody, route } from "@/lib/api";
import { competitorCreate } from "@/lib/validators";

export const GET = route("VIEWER", async ({ session }) =>
  db.competitor.findMany({
    where: { workspaceId: session.workspaceId },
    orderBy: [{ tier: "asc" }, { name: "asc" }],
    include: { _count: { select: { signals: true, sources: true } } },
  }),
);

export const POST = route("ANALYST", async ({ session, req }) => {
  const body = await parseBody(req, competitorCreate);
  return db.competitor.create({ data: { ...body, workspaceId: session.workspaceId } });
});
