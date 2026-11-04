import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { db } from "./db";
import type { signalQuery } from "./validators";

export type SignalFilters = z.infer<typeof signalQuery>;

/** Shared by GET /api/v1/signals and the server-rendered feed so both behave identically. */
export async function listSignals(workspaceId: string, f: SignalFilters) {
  const where: Prisma.SignalWhereInput = {
    workspaceId,
    duplicateOfId: f.q ? undefined : null, // story leads only; search spans all coverage
    status: f.status ?? { not: "ARCHIVED" },
    type: f.type,
    competitorId: f.competitorId,
    importance: f.minImportance ? { gte: f.minImportance } : undefined,
    tags: f.tag ? { some: { tag: { name: f.tag.toLowerCase() } } } : undefined,
    // ILIKE is fine to ~1M rows/workspace; then add a tsvector GIN index (see ARCHITECTURE.md).
    OR: f.q
      ? [
          { title: { contains: f.q, mode: "insensitive" } },
          { summary: { contains: f.q, mode: "insensitive" } },
        ]
      : undefined,
  };
  const rows = await db.signal.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: {
      competitor: { select: { id: true, name: true } },
      source: { select: { id: true, name: true } },
      tags: { include: { tag: true } },
      _count: { select: { comments: true, coverage: true } },
    },
  });
  const hasMore = rows.length > f.limit;
  const items = hasMore ? rows.slice(0, f.limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export async function workspaceStats(workspaceId: string) {
  const since = new Date(Date.now() - 7 * 864e5);
  const [newCount, escalated, week, byType, byCompetitor, failingSources] = await Promise.all([
    db.signal.count({ where: { workspaceId, status: "NEW", duplicateOfId: null } }),
    db.signal.count({ where: { workspaceId, status: "ESCALATED", duplicateOfId: null } }),
    db.signal.count({ where: { workspaceId, createdAt: { gte: since }, duplicateOfId: null } }),
    db.signal.groupBy({
      by: ["type"],
      where: { workspaceId, createdAt: { gte: since }, duplicateOfId: null },
      _count: { _all: true },
    }),
    db.signal.groupBy({
      by: ["competitorId"],
      where: { workspaceId, createdAt: { gte: since }, competitorId: { not: null }, duplicateOfId: null },
      _count: { _all: true },
      orderBy: { _count: { competitorId: "desc" } },
      take: 5,
    }),
    db.source.count({ where: { workspaceId, enabled: true, lastError: { not: null } } }),
  ]);
  const names = await db.competitor.findMany({
    where: { id: { in: byCompetitor.map((c) => c.competitorId!) } },
    select: { id: true, name: true },
  });
  const nameOf = Object.fromEntries(names.map((n) => [n.id, n.name]));
  return {
    newCount,
    escalated,
    week,
    failingSources,
    byType: byType.map((t) => ({ type: t.type, count: t._count._all })).sort((a, b) => b.count - a.count),
    topCompetitors: byCompetitor.map((c) => ({ id: c.competitorId!, name: nameOf[c.competitorId!] ?? "?", count: c._count._all })),
  };
}
