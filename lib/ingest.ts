import Parser from "rss-parser";
import { db } from "./db";
import { ingestSignal } from "./signals";
import { safeFetch } from "./net";

const parser = new Parser();
const UA = { "User-Agent": "LookoutBot/0.2 (+competitive-intel)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" };

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Polls one RSS/Atom source and ingests new items. Returns count of new signals. */
export async function pollSource(sourceId: string): Promise<number> {
  const source = await db.source.findUnique({ where: { id: sourceId } });
  if (!source || !source.enabled || source.kind !== "RSS" || !source.url) return 0;

  try {
    // Fetch ourselves (SSRF-checked on every redirect hop, size-capped), then parse.
    const res = await safeFetch(source.url, { headers: UA });
    if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`);
    const feed = await parser.parseString(res.text);
    let created = 0;
    // Cap per poll so one firehose feed can't starve the queue.
    for (const item of feed.items.slice(0, 50)) {
      if (!item.title) continue;
      const summary = stripHtml(item.contentSnippet ?? item.content ?? item.summary ?? "").slice(0, 2000);
      const s = await ingestSignal(source.workspaceId, {
        title: item.title.trim(),
        url: item.link ?? null,
        summary: summary || null,
        publishedAt: item.isoDate ? new Date(item.isoDate) : null,
        sourceId: source.id,
        // Competitor-specific source → always attribute; general source → let the matcher decide.
        competitorId: source.competitorId ?? undefined,
      });
      if (s) created++;
    }
    await db.source.update({ where: { id: source.id }, data: { lastPolledAt: new Date(), lastError: null } });
    return created;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.source.update({ where: { id: source.id }, data: { lastPolledAt: new Date(), lastError: msg.slice(0, 500) } });
    throw err;
  }
}

/**
 * Claims RSS sources whose poll interval has elapsed and stamps lastPolledAt in the same
 * statement, so concurrent schedulers never enqueue the same source twice.
 */
export async function claimDueSources(limit = 100) {
  return db.$queryRaw<Array<{ id: string; workspaceId: string }>>`
    UPDATE "Source" SET "lastPolledAt" = (now() AT TIME ZONE 'UTC')
    WHERE id IN (
      SELECT id FROM "Source"
      WHERE enabled AND kind = 'RSS'
        AND ("lastPolledAt" IS NULL OR "lastPolledAt" + ("pollMinutes" * interval '1 minute') <= (now() AT TIME ZONE 'UTC'))
      ORDER BY "lastPolledAt" NULLS FIRST
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, "workspaceId"`;
}
