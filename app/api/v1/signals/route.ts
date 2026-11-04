import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { HttpError, parseBody, parseQuery, route } from "@/lib/api";
import { signalCreate, signalQuery } from "@/lib/validators";
import { listSignals } from "@/lib/queries";
import { ingestSignal } from "@/lib/signals";

export const GET = route("VIEWER", async ({ session, req }) =>
  listSignals(session.workspaceId, parseQuery(req, signalQuery)),
);

/** Manual signal entry (field intel, call notes, broker chatter). Same pipeline as ingestion. */
export const POST = route("ANALYST", async ({ session, req }) => {
  const body = await parseBody(req, signalCreate);
  if (body.competitorId) {
    const ok = await db.competitor.count({ where: { id: body.competitorId, workspaceId: session.workspaceId } });
    if (!ok) throw new HttpError(422, "Unknown competitor");
  }
  const signal = await ingestSignal(session.workspaceId, body);
  if (!signal) throw new HttpError(409, "A signal with this URL/title already exists");
  return NextResponse.json({ data: signal }, { status: 201 });
});
