-- CreateEnum
CREATE TYPE "public"."Funding" AS ENUM ('FULLY_INSURED', 'SELF_INSURED');

-- CreateTable
CREATE TABLE "public"."MarketEnrollment" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "payer" TEXT NOT NULL,
    "funding" "public"."Funding" NOT NULL,
    "segment" "public"."Segment" NOT NULL,
    "sector" TEXT NOT NULL,
    "productType" TEXT NOT NULL DEFAULT '',
    "members" DOUBLE PRECISION NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "MarketEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StateFinancial" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "company" TEXT NOT NULL,
    "segment" "public"."Segment" NOT NULL,
    "coveredLives" DOUBLE PRECISION,
    "memberMonths" DOUBLE PRECISION,
    "premium" DOUBLE PRECISION NOT NULL,
    "claims" DOUBLE PRECISION NOT NULL,
    "reserveChange" DOUBLE PRECISION,
    "adminExpense" DOUBLE PRECISION,
    "underwritingGain" DOUBLE PRECISION,
    "isTotal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StateFinancial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GroupRateAction" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "segment" "public"."Segment" NOT NULL,
    "planYear" INTEGER NOT NULL,
    "carrier" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "members" DOUBLE PRECISION,
    "requested" DOUBLE PRECISION,
    "approved" DOUBLE PRECISION,
    "details" JSONB,
    "isTotal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GroupRateAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketEnrollment_state_segment_asOf_idx" ON "public"."MarketEnrollment"("state", "segment", "asOf");

-- CreateIndex
CREATE INDEX "MarketEnrollment_payer_idx" ON "public"."MarketEnrollment"("payer");

-- CreateIndex
CREATE UNIQUE INDEX "MarketEnrollment_source_state_asOf_payer_funding_sector_pro_key" ON "public"."MarketEnrollment"("source", "state", "asOf", "payer", "funding", "sector", "productType");

-- CreateIndex
CREATE INDEX "StateFinancial_state_segment_year_idx" ON "public"."StateFinancial"("state", "segment", "year");

-- CreateIndex
CREATE UNIQUE INDEX "StateFinancial_source_state_year_company_segment_key" ON "public"."StateFinancial"("source", "state", "year", "company", "segment");

-- CreateIndex
CREATE INDEX "GroupRateAction_state_segment_planYear_idx" ON "public"."GroupRateAction"("state", "segment", "planYear");

-- CreateIndex
CREATE UNIQUE INDEX "GroupRateAction_source_state_segment_planYear_carrier_key" ON "public"."GroupRateAction"("source", "state", "segment", "planYear", "carrier");
