import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, parseBody, route } from "@/lib/api";
import { findPack, googleNewsUrl, STARTER_PACKS } from "@/lib/starter-packs";
import { enqueue } from "@/lib/jobs";

export const GET = route("VIEWER", async () =>
  STARTER_PACKS.map((p) => ({ id: p.id, name: p.name, description: p.description, competitors: p.competitors.length })),
);

/**
 * Loads a starter pack into the workspace. Idempotent: existing competitors (by name) and sources
 * (by URL) are left alone. New sources are polled immediately so the feed fills within minutes.
 */
export const POST = route("ANALYST", async ({ session, req }) => {
  const { pack: packId } = await parseBody(req, z.object({ pack: z.string() }));
  const pack = findPack(packId);
  if (!pack) throw new HttpError(404, "Unknown starter pack");
  const workspaceId = session.workspaceId;

  const existingSources = new Set(
    (await db.source.findMany({ where: { workspaceId }, select: { url: true } })).map((s) => s.url),
  );
  let competitors = 0;
  const newSources: Array<{ id: string }> = [];

  for (const c of pack.competitors) {
    const existing = await db.competitor.findUnique({ where: { workspaceId_name: { workspaceId, name: c.name } } });
    let comp;
    if (existing) {
      // Same company from another pack: keep the user's tier/notes, union the aliases.
      const merged = [...new Set([...existing.aliases, ...c.aliases])];
      comp = merged.length === existing.aliases.length
        ? existing
        : await db.competitor.update({ where: { id: existing.id }, data: { aliases: merged } });
    } else {
      comp = await db.competitor.create({
        // issuerPattern stays null → the curated pattern (lib/starter-packs) applies and improves with each release.
        data: { workspaceId, name: c.name, aliases: c.aliases, tier: c.tier, website: c.website },
      });
    }
    if (!existing) competitors++;
    const url = googleNewsUrl(c.query);
    if (!existingSources.has(url)) {
      newSources.push(
        await db.source.create({
          data: { workspaceId, competitorId: comp.id, name: `${c.name} — ${pack.name} news`, url, pollMinutes: 60 },
        }),
      );
    }
  }
  for (const s of pack.marketSources) {
    if (!existingSources.has(s.url))
      newSources.push(await db.source.create({ data: { workspaceId, name: s.name, url: s.url, pollMinutes: 60 } }));
  }
  // Stamp so the scheduler doesn't double-enqueue, then poll everything now.
  await db.source.updateMany({ where: { id: { in: newSources.map((s) => s.id) } }, data: { lastPolledAt: new Date() } });
  // Spread first polls over a few minutes rather than one burst (aggregators throttle bursts).
  for (const [i, s] of newSources.entries())
    await enqueue(workspaceId, "poll_source", { sourceId: s.id }, new Date(Date.now() + i * 5000));

  return { competitors, sources: newSources.length };
});
