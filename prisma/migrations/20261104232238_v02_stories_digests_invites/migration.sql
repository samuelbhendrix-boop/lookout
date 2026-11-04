-- CreateEnum
CREATE TYPE "public"."AlertMode" AS ENUM ('INSTANT', 'DIGEST_WEEKLY');

-- AlterTable
ALTER TABLE "public"."AlertRule" ADD COLUMN     "mode" "public"."AlertMode" NOT NULL DEFAULT 'INSTANT';

-- AlterTable
ALTER TABLE "public"."Signal" ADD COLUMN     "duplicateOfId" TEXT;

-- CreateTable
CREATE TABLE "public"."Invite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" "public"."Role" NOT NULL DEFAULT 'ANALYST',
    "createdById" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 25,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "public"."Invite"("tokenHash");

-- CreateIndex
CREATE INDEX "Invite_workspaceId_idx" ON "public"."Invite"("workspaceId");

-- CreateIndex
CREATE INDEX "AlertRule_mode_enabled_lastFiredAt_idx" ON "public"."AlertRule"("mode", "enabled", "lastFiredAt");

-- CreateIndex
CREATE INDEX "Signal_duplicateOfId_idx" ON "public"."Signal"("duplicateOfId");

-- AddForeignKey
ALTER TABLE "public"."Signal" ADD CONSTRAINT "Signal_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "public"."Signal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Invite" ADD CONSTRAINT "Invite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Invite" ADD CONSTRAINT "Invite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
