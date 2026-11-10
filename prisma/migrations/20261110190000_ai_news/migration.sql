-- CreateTable
CREATE TABLE "public"."AiNews" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "outlet" TEXT,
    "summary" TEXT,
    "publishedAt" TIMESTAMP(3),
    "feed" TEXT NOT NULL,
    "judged" BOOLEAN NOT NULL DEFAULT false,
    "relevant" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,
    "impact" INTEGER,
    "why" TEXT,
    "story" TEXT,
    "companies" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiNews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiNews_url_key" ON "public"."AiNews"("url");

-- CreateIndex
CREATE UNIQUE INDEX "AiNews_titleKey_key" ON "public"."AiNews"("titleKey");

-- CreateIndex
CREATE INDEX "AiNews_relevant_publishedAt_idx" ON "public"."AiNews"("relevant", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "AiNews_judged_idx" ON "public"."AiNews"("judged");

