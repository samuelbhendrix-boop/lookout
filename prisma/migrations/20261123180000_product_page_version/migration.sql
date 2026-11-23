-- CreateTable
CREATE TABLE "ProductPageVersion" (
    "id" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "added" JSONB NOT NULL,
    "removed" JSONB NOT NULL,

    CONSTRAINT "ProductPageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductPageVersion_site_replacedAt_idx" ON "ProductPageVersion"("site", "replacedAt" DESC);

-- CreateIndex
CREATE INDEX "ProductPageVersion_url_idx" ON "ProductPageVersion"("url");

