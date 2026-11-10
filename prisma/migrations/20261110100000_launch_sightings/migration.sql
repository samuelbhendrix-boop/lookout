CREATE TABLE "LaunchSighting" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "detail" JSONB,
    "baseline" BOOLEAN NOT NULL DEFAULT false,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LaunchSighting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LaunchSighting_kind_site_key_key" ON "LaunchSighting"("kind", "site", "key");
CREATE INDEX "LaunchSighting_kind_firstSeen_idx" ON "LaunchSighting"("kind", "firstSeen");
