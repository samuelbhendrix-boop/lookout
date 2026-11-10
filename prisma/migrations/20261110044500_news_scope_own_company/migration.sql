-- Per-competitor news scope, and the workspace's own carrier.
ALTER TABLE "Competitor" ADD COLUMN "newsScope" TEXT NOT NULL DEFAULT 'all';
ALTER TABLE "Workspace" ADD COLUMN "ownCompetitorId" TEXT;

-- National carriers default to New England-only news (their national coverage flooded the feed).
UPDATE "Competitor" SET "newsScope" = 'region'
WHERE name ~* '(unitedhealth|united healthcare|cigna|aetna|cvs|elevance|anthem|centene|ambetter|molina|humana|oscar|kaiser|hcsc|health care service)';
