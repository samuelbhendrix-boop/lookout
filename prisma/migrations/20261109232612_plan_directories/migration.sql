-- CreateTable
CREATE TABLE "public"."PlanNetworkStat" (
    "id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "individuals" INTEGER NOT NULL DEFAULT 0,
    "pcps" INTEGER NOT NULL DEFAULT 0,
    "accepting" INTEGER NOT NULL DEFAULT 0,
    "hospitals" INTEGER NOT NULL DEFAULT 0,
    "facilities" INTEGER NOT NULL DEFAULT 0,
    "byState" JSONB,
    "drugs" INTEGER,
    "pa" INTEGER,
    "st" INTEGER,
    "ql" INTEGER,

    CONSTRAINT "PlanNetworkStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlanHospital" (
    "id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "npi" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,

    CONSTRAINT "PlanHospital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlanDrug" (
    "id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "group" TEXT NOT NULL,
    "covered" BOOLEAN NOT NULL,
    "tier" TEXT,
    "pa" BOOLEAN NOT NULL DEFAULT false,
    "st" BOOLEAN NOT NULL DEFAULT false,
    "ql" BOOLEAN NOT NULL DEFAULT false,
    "drugs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlanDrug_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanNetworkStat_planId_idx" ON "public"."PlanNetworkStat"("planId");

-- CreateIndex
CREATE INDEX "PlanNetworkStat_carrier_year_idx" ON "public"."PlanNetworkStat"("carrier", "year");

-- CreateIndex
CREATE INDEX "PlanHospital_planId_year_idx" ON "public"."PlanHospital"("planId", "year");

-- CreateIndex
CREATE INDEX "PlanDrug_planId_year_idx" ON "public"."PlanDrug"("planId", "year");
