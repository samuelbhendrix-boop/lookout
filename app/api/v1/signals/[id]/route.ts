import { db } from "@/lib/db";
import { HttpError, parseBody, route } from "@/lib/api";
import { signalUpdate } from "@/lib/validators";
import { setTags } from "@/lib/signals";

type P = { id: string };

async function assertOwned(workspaceId: string, id: string) {
  const n = await db.signal.count({ where: { id, workspaceId } });
  if (!n) throw new HttpError(404, "Signal not found");
}

const detail = (id: string) =>
  db.signal.findUnique({
    where: { id },
    include: {
      competitor: true,
      source: { select: { id: true, name: true, url: true } },
      tags: { include: { tag: true } },
      duplicateOf: { select: { id: true, title: true } },
      coverage: {
        orderBy: { createdAt: "asc" },
        select: { id: true, title: true, url: true, createdAt: true, source: { select: { id: true, name: true } } },
      },
      comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true, email: true } } } },
    },
  });

export const GET = route<P>("VIEWER", async ({ session, params }) => {
  await assertOwned(session.workspaceId, params.id);
  return detail(params.id);
});

/** Triage: status, re-classify, re-attribute, edit summary, replace tags. */
export const PATCH = route<P>("ANALYST", async ({ session, params, req }) => {
  await assertOwned(session.workspaceId, params.id);
  const { tags, ...fields } = await parseBody(req, signalUpdate);
  if (fields.competitorId) {
    const ok = await db.competitor.count({ where: { id: fields.competitorId, workspaceId: session.workspaceId } });
    if (!ok) throw new HttpError(422, "Unknown competitor");
  }
  await db.signal.update({ where: { id: params.id }, data: fields });
  if (tags) await setTags(session.workspaceId, params.id, tags);
  return detail(params.id);
});

export const DELETE = route<P>("ADMIN", async ({ session, params }) => {
  await assertOwned(session.workspaceId, params.id);
  await db.signal.delete({ where: { id: params.id } });
  return null;
});
