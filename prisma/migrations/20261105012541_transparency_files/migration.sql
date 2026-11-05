-- CreateTable
CREATE TABLE "public"."PlanAdministration" (
    "id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "reportingEntity" TEXT NOT NULL,
    "entityType" TEXT,
    "ein" TEXT NOT NULL,
    "sponsorName" TEXT,
    "planName" TEXT NOT NULL,
    "marketType" TEXT,
    "tocUrl" TEXT,
    "asOf" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanAdministration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MrfSource" (
    "id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "error" TEXT,
    "stats" JSONB,

    CONSTRAINT "MrfSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanAdministration_ein_idx" ON "public"."PlanAdministration"("ein");

-- CreateIndex
CREATE UNIQUE INDEX "PlanAdministration_carrier_ein_planName_key" ON "public"."PlanAdministration"("carrier", "ein", "planName");
