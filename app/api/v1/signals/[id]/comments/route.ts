import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { HttpError, parseBody, route } from "@/lib/api";
import { commentCreate } from "@/lib/validators";

type P = { id: string };

async function assertOwned(workspaceId: string, id: string) {
  if (!(await db.signal.count({ where: { id, workspaceId } }))) throw new HttpError(404, "Signal not found");
}

export const GET = route<P>("VIEWER", async ({ session, params }) => {
  await assertOwned(session.workspaceId, params.id);
  return db.comment.findMany({
    where: { signalId: params.id },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, email: true } } },
  });
});

export const POST = route<P>("ANALYST", async ({ session, params, req }) => {
  await assertOwned(session.workspaceId, params.id);
  const { body } = await parseBody(req, commentCreate);
  const c = await db.comment.create({
    data: { signalId: params.id, authorId: session.userId, body },
    include: { author: { select: { id: true, name: true, email: true } } },
  });
  return NextResponse.json({ data: c }, { status: 201 });
});
