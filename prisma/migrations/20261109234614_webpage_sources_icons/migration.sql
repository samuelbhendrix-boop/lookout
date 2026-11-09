-- AlterEnum
ALTER TYPE "public"."SourceKind" ADD VALUE 'WEBPAGE';

-- AlterTable
ALTER TABLE "public"."Source" ADD COLUMN     "state" JSONB;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "icon" TEXT;

-- AlterTable
ALTER TABLE "public"."Workspace" ADD COLUMN     "icon" TEXT;
