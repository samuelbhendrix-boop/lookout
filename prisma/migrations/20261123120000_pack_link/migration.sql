-- CreateTable
CREATE TABLE "PackLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PackLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PackLink_workspaceId_key" ON "PackLink"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PackLink_tokenHash_key" ON "PackLink"("tokenHash");
