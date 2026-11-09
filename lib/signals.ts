import type { SignalStatus, SignalType } from "@prisma/client";
import { db } from "./db";
import { classify } from "./classify";
import { dedupeKey, matchCompetitor } from "./match";
import { evaluateAlerts } from "./alerts";
import { CLUSTER_WINDOW_HOURS, findLead } from "./cluster";
import { AUTO_FILTER_TAG, mentions } from "./relevance";

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

  const tagNames = [...new Set([...(input.tags ?? []), ...(status === "ARCHIVED" ? [AUTO_FILTER_TAG] : [])].map((t) => t.toLowerCase()))];

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
