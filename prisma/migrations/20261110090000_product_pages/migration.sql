CREATE TABLE "ProductPage" (
    "id" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "hash" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductPage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductPage_url_key" ON "ProductPage"("url");
CREATE INDEX "ProductPage_site_idx" ON "ProductPage"("site");
