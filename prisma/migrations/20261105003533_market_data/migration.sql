-- CreateEnum
CREATE TYPE "public"."Segment" AS ENUM ('INDIVIDUAL', 'SMALL_GROUP', 'LARGE_GROUP');

-- AlterTable
ALTER TABLE "public"."Competitor" ADD COLUMN     "issuerPattern" TEXT;

-- CreateTable
CREATE TABLE "public"."RateFiling" (
    "id" TEXT NOT NULL,
    "planYear" INTEGER NOT NULL,
    "serffNumber" TEXT,
    "primaryReviewer" TEXT,
    "state" TEXT NOT NULL,
    "hiosId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "expPremium" DOUBLE PRECISION,
    "expClaims" DOUBLE PRECISION,
    "expMemberMonths" DOUBLE PRECISION,
    "projMemberMonths" DOUBLE PRECISION,
    "projIndexRate" DOUBLE PRECISION,

    CONSTRAINT "RateFiling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RatePlan" (
    "id" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "planYear" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "hiosId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "metal" TEXT,
    "planType" TEXT,
    "onExchange" BOOLEAN NOT NULL,
    "category" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "rateChange" DOUBLE PRECISION,
    "enrollment" INTEGER,
    "ratePmpm" DOUBLE PRECISION,
    "expLossRatio" DOUBLE PRECISION,
    "projPremiumPmpm" DOUBLE PRECISION,
    "determination" TEXT,

    CONSTRAINT "RatePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MarketFinancial" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "hiosId" TEXT,
    "company" TEXT NOT NULL,
    "naicCode" TEXT,
    "groupName" TEXT,
    "segment" "public"."Segment" NOT NULL,
    "premium" DOUBLE PRECISION NOT NULL,
    "claims" DOUBLE PRECISION NOT NULL,
    "coveredLives" DOUBLE PRECISION NOT NULL,
    "memberMonths" DOUBLE PRECISION NOT NULL,
    "brokerFees" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MarketFinancial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DataImport" (
    "id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DataImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateFiling_state_planYear_idx" ON "public"."RateFiling"("state", "planYear");

-- CreateIndex
CREATE INDEX "RateFiling_company_idx" ON "public"."RateFiling"("company");

-- CreateIndex
CREATE INDEX "RatePlan_state_planYear_market_idx" ON "public"."RatePlan"("state", "planYear", "market");

-- CreateIndex
CREATE INDEX "RatePlan_company_idx" ON "public"."RatePlan"("company");

-- CreateIndex
CREATE INDEX "RatePlan_planId_idx" ON "public"."RatePlan"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "RatePlan_filingId_planId_key" ON "public"."RatePlan"("filingId", "planId");

-- CreateIndex
CREATE INDEX "MarketFinancial_state_year_segment_idx" ON "public"."MarketFinancial"("state", "year", "segment");

-- CreateIndex
CREATE INDEX "MarketFinancial_company_idx" ON "public"."MarketFinancial"("company");

-- CreateIndex
CREATE UNIQUE INDEX "MarketFinancial_year_state_company_segment_key" ON "public"."MarketFinancial"("year", "state", "company", "segment");

-- CreateIndex
CREATE UNIQUE INDEX "DataImport_dataset_year_key" ON "public"."DataImport"("dataset", "year");

-- AddForeignKey
ALTER TABLE "public"."RatePlan" ADD CONSTRAINT "RatePlan_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "public"."RateFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;
