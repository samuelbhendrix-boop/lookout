-- CreateIndex
CREATE INDEX "Signal_workspaceId_publishedAt_idx" ON "public"."Signal"("workspaceId", "publishedAt" DESC);

-- ── One-time feed cleanup (v0.3.1) ──────────────────────────────────
-- 0) Broaden starter-pack aliases on existing competitors (relevance filter relies on them).
UPDATE "Competitor" SET aliases = array(SELECT DISTINCT unnest(aliases || ARRAY['cvs'])) WHERE name = 'Aetna';
UPDATE "Competitor" SET aliases = array(SELECT DISTINCT unnest(aliases || ARRAY['neighborhood health'])) WHERE name = 'Neighborhood Health Plan of Rhode Island';
UPDATE "Competitor" SET aliases = array(SELECT DISTINCT unnest(aliases || ARRAY['tufts health'])) WHERE name = 'Point32Health';
UPDATE "Competitor" SET aliases = array(SELECT DISTINCT unnest(aliases || ARRAY['blue cross of massachusetts', 'blue cross and blue shield of massachusetts'])) WHERE name = 'Blue Cross Blue Shield of Massachusetts';
UPDATE "Competitor" SET aliases = array(SELECT DISTINCT unnest(aliases || ARRAY['mass general brigham health'])) WHERE name = 'Mass General Brigham Health Plan';

-- 1) Manual signals had no publish date; treat creation time as publication time.
UPDATE "Signal" SET "publishedAt" = "createdAt" WHERE "publishedAt" IS NULL;

-- 2) Archive untriaged items that were already old when fetched (first polls of news searches
--    returned years-old articles). Analysts' own triage decisions (non-NEW) are left untouched.
UPDATE "Signal" SET status = 'ARCHIVED'
WHERE status = 'NEW' AND "publishedAt" < "createdAt" - interval '30 days';

-- 3) Archive untriaged items from a competitor's own feed that never name that competitor.
--    (Substring check on name/aliases; the live filter uses whole-word matching.)
UPDATE "Signal" s SET status = 'ARCHIVED'
FROM "Source" src JOIN "Competitor" c ON c.id = src."competitorId"
WHERE s."sourceId" = src.id AND s.status = 'NEW'
  AND NOT EXISTS (
    SELECT 1 FROM unnest(array_append(c.aliases, lower(c.name))) AS a(term)
    WHERE length(a.term) > 1 AND lower(s.title || ' ' || coalesce(s.summary, '')) LIKE '%' || a.term || '%'
  );

-- 4) Tag everything archived by this cleanup so it can be reviewed (Feed → tag "auto-filtered").
INSERT INTO "Tag" (id, "workspaceId", name)
SELECT 'autofilter_' || w.id, w.id, 'auto-filtered' FROM "Workspace" w
ON CONFLICT ("workspaceId", name) DO NOTHING;
INSERT INTO "SignalTag" ("signalId", "tagId")
SELECT s.id, t.id FROM "Signal" s JOIN "Tag" t ON t."workspaceId" = s."workspaceId" AND t.name = 'auto-filtered'
WHERE s.status = 'ARCHIVED' AND s."updatedAt" < now() AND NOT EXISTS (SELECT 1 FROM "SignalTag" st WHERE st."signalId" = s.id AND st."tagId" = t.id)
  AND (s."publishedAt" < s."createdAt" - interval '30 days'
       OR EXISTS (SELECT 1 FROM "Source" src WHERE src.id = s."sourceId" AND src."competitorId" IS NOT NULL));
