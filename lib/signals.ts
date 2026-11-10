import type { SignalStatus, SignalType } from "@prisma/client";
import { db } from "./db";
import { classify } from "./classify";
import { dedupeKey, matchCompetitor } from "./match";
import { evaluateAlerts } from "./alerts";
import { CLUSTER_WINDOW_HOURS, findLead } from "./cluster";
import { AUTO_FILTER_TAG, OUTSIDE_REGION_TAG, mentions, regionRelevant } from "./relevance";

export type SignalInput = {
  title: string;
  url?: string | null;
  summary?: string | null;
  publishedAt?: Date | null;
  sourceId?: string | null;
  competitorId?: string | null; // explicit attribution beats the matcher
  type?: SignalType;
  importance?: number;
  tags?: string[];
  /** Where a feed item came from — drives the off-topic filter. Omit for manual entries. */
  origin?: "competitor-feed" | "market-feed";
  /** Store without firing alert rules (back-filled history). */
  silent?: boolean;
};

/**
 * Single write path for signals — used by manual entry (API) and ingestion (worker).
 * Dedupes, attributes, classifies, clusters, tags, then evaluates alert rules (story leads only).
 * Returns null when the signal already existed.
 */
export async function ingestSignal(workspaceId: string, input: SignalInput) {
  const key = dedupeKey(workspaceId, input.url, input.title);
  const exists = await db.signal.findUnique({
    where: { workspaceId_dedupeKey: { workspaceId, dedupeKey: key } },
    select: { id: true },
  });
  if (exists) return null;

  const text = `${input.title}\n${input.summary ?? ""}`;
  let competitorId = input.competitorId ?? null;
  if (competitorId === null && input.competitorId === undefined) {
    const competitors = await db.competitor.findMany({
      where: { workspaceId },
      select: { id: true, name: true, aliases: true },
    });
    competitorId = matchCompetitor(text, competitors);
  }

  const auto = input.type && input.importance ? null : await classify(input.title, input.summary ?? "");
  const type = input.type ?? auto!.type;
  const importance = input.importance ?? auto!.importance;

  // Cluster feed items into existing stories. Manual entries are deliberate intel — never hidden.
  let duplicateOfId: string | null = null;
  if (input.sourceId) {
    const candidates = await db.signal.findMany({
      where: {
        workspaceId,
        competitorId,
        createdAt: { gte: new Date(Date.now() - CLUSTER_WINDOW_HOURS * 3600e3) },
      },
      orderBy: { createdAt: "asc" }, // earliest match wins → stable lead
      take: 500,
      select: { id: true, title: true, duplicateOfId: true, competitorId: true },
    });
    duplicateOfId = findLead(input.title, competitorId, candidates);
  }

  // Off-topic filter (see lib/relevance.ts): archive rather than drop, so it stays auditable.
  let status: SignalStatus = "NEW";
  if (input.origin === "competitor-feed" && competitorId) {
    const c = await db.competitor.findUnique({ where: { id: competitorId }, select: { id: true, name: true, aliases: true } });
    if (c && !mentions(text, c)) status = "ARCHIVED";
  } else if (input.origin === "market-feed" && !competitorId && type === "OTHER") {
    status = "ARCHIVED";
  }

  // National carriers scoped to New England: feed stories that don't touch the region (or the carrier's commercial
  // and exchange moves) are archived. The source's own name counts, so a regional outlet's coverage stays.
  const extraTags: string[] = [];
  if (status === "NEW" && competitorId && input.sourceId) {
    const [c, src] = await Promise.all([
      db.competitor.findUnique({ where: { id: competitorId }, select: { newsScope: true } }),
      db.source.findUnique({ where: { id: input.sourceId }, select: { name: true } }),
    ]);
    if (c?.newsScope === "region" && !regionRelevant(`${text}\n${src?.name ?? ""}`)) { status = "ARCHIVED"; extraTags.push(OUTSIDE_REGION_TAG); }
  }

  const tagNames = [...new Set([...(input.tags ?? []), ...extraTags, ...(status === "ARCHIVED" ? [AUTO_FILTER_TAG] : [])].map((t) => t.toLowerCase()))];

  // INSERT … ON CONFLICT DO NOTHING: a concurrent poll that wins the race simply makes this a no-op.
  const [signal] = await db.signal.createManyAndReturn({
    skipDuplicates: true,
    data: [
      {
        workspaceId,
        sourceId: input.sourceId ?? null,
        competitorId,
        title: input.title.slice(0, 500),
        url: input.url ?? null,
        summary: input.summary?.slice(0, 10000) ?? null,
        dedupeKey: key,
        type,
        importance,
        publishedAt: input.publishedAt ?? new Date(), // manual entries are "now"
        duplicateOfId,
        status,
      },
    ],
  });
  if (!signal) return null;

  if (tagNames.length) await setTags(workspaceId, signal.id, tagNames);
  if (!signal.duplicateOfId && signal.status !== "ARCHIVED" && !input.silent) await evaluateAlerts(signal);
  return signal;
}

/** Replaces a signal's tag set. */
export async function setTags(workspaceId: string, signalId: string, tags: string[]) {
  const names = [...new Set(tags.map((t) => t.toLowerCase()))];
  await db.$transaction(async (tx) => {
    await tx.signalTag.deleteMany({ where: { signalId } });
    for (const name of names) {
      const tag = await tx.tag.upsert({
        where: { workspaceId_name: { workspaceId, name } },
        create: { workspaceId, name },
        update: {},
      });
      await tx.signalTag.create({ data: { signalId, tagId: tag.id } });
    }
  });
}

/**
 * Re-applies each competitor's news scope to feed stories already stored (last 120 days): archives stories outside
 * New England for "region" competitors, and restores ones this filter archived when a competitor is set back to
 * "all". Manual entries are never touched. Returns how many stories changed.
 */
export async function applyNewsScope(workspaceId?: string, competitorId?: string): Promise<{ archived: number; restored: number }> {
  const { regionRelevant: ok, OUTSIDE_REGION_TAG: TAG, AUTO_FILTER_TAG: AUTO } = await import("./relevance");
  const comps = await db.competitor.findMany({ where: { ...(workspaceId ? { workspaceId } : {}), ...(competitorId ? { id: competitorId } : {}) }, select: { id: true, workspaceId: true, newsScope: true, name: true, aliases: true } });
  const since = new Date(Date.now() - 120 * 864e5);
  let archived = 0, restored = 0;
  const tagId = async (ws: string, name: string) => (await db.tag.upsert({ where: { workspaceId_name: { workspaceId: ws, name } }, create: { workspaceId: ws, name }, update: {} })).id;
  for (const c of comps) {
    if (c.newsScope === "region") {
      const rows = await db.signal.findMany({ where: { competitorId: c.id, sourceId: { not: null }, status: { not: "ARCHIVED" }, createdAt: { gte: since } }, select: { id: true, title: true, summary: true, source: { select: { name: true } } } });
      // Out of region, or doesn't actually name the carrier (alias collisions such as "national anthem").
      const out = rows.filter((r) => !ok(`${r.title}\n${r.summary ?? ""}\n${r.source?.name ?? ""}`) || !mentions(`${r.title}\n${r.summary ?? ""}`, c)).map((r) => r.id);
      if (!out.length) continue;
      const [t1, t2] = [await tagId(c.workspaceId, TAG), await tagId(c.workspaceId, AUTO)];
      for (let i = 0; i < out.length; i += 1000) {
        const ids = out.slice(i, i + 1000);
        await db.signal.updateMany({ where: { id: { in: ids } }, data: { status: "ARCHIVED" } });
        await db.signalTag.createMany({ data: ids.flatMap((signalId) => [{ signalId, tagId: t1 }, { signalId, tagId: t2 }]), skipDuplicates: true });
      }
      archived += out.length;
    } else {
      const rows = await db.signal.findMany({ where: { competitorId: c.id, status: "ARCHIVED", tags: { some: { tag: { name: TAG } } } }, select: { id: true } });
      if (!rows.length) continue;
      const ids = rows.map((r) => r.id);
      await db.signal.updateMany({ where: { id: { in: ids } }, data: { status: "NEW" } });
      await db.signalTag.deleteMany({ where: { signalId: { in: ids }, tag: { name: { in: [TAG, AUTO] } } } });
      restored += ids.length;
    }
  }
  return { archived, restored };
}
