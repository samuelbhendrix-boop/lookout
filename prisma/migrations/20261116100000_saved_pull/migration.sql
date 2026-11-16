-- CreateTable
CREATE TABLE "public"."SavedPull" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedPull_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedPull_workspaceId_idx" ON "public"."SavedPull"("workspaceId");

