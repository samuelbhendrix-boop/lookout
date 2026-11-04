import { parseQuery, route } from "@/lib/api";
import { signalQuery } from "@/lib/validators";
import { listSignals } from "@/lib/queries";
import { toCsv } from "@/lib/csv";

const MAX_ROWS = 5000;

/** CSV of the current feed view (same filters as GET /signals) — for decks and spreadsheets. */
export const GET = route("VIEWER", async ({ session, req }) => {
  const filters = parseQuery(req, signalQuery.omit({ cursor: true, limit: true }));
  const base = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || new URL(req.url).origin;
  const rows: unknown[][] = [];
  let cursor: string | undefined;
  do {
    const page = await listSignals(session.workspaceId, { ...filters, cursor, limit: 500 });
    for (const s of page.items)
      rows.push([
        s.publishedAt ?? s.createdAt, s.competitor?.name, s.type, s.importance, s.status, s.title,
        s.url, s.source?.name ?? "manual", s.tags.map((t) => t.tag.name).join("; "), s._count.coverage,
        s.summary, `${base}/signals/${s.id}`,
      ]);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && rows.length < MAX_ROWS);

  const csv = toCsv(
    ["date", "competitor", "type", "importance", "status", "title", "url", "source", "tags", "other_outlets", "summary", "lookout_link"],
    rows.slice(0, MAX_ROWS),
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lookout-signals-${stamp}.csv"`,
    },
  });
});
