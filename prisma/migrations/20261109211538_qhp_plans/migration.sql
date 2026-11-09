-- CreateTable
CREATE TABLE "public"."QhpPlan" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "issuerName" TEXT,
    "market" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metal" TEXT,
    "planType" TEXT,
    "networkId" TEXT,
    "networkName" TEXT,
    "serviceAreaId" TEXT,
    "statewide" BOOLEAN NOT NULL DEFAULT false,
    "counties" INTEGER,
    "isNew" BOOLEAN NOT NULL DEFAULT false,
    "standardized" BOOLEAN NOT NULL DEFAULT false,
    "hsa" BOOLEAN NOT NULL DEFAULT false,
    "nationalNetwork" BOOLEAN NOT NULL DEFAULT false,
    "referral" BOOLEAN NOT NULL DEFAULT false,
    "tiered" BOOLEAN NOT NULL DEFAULT false,
    "outOfNetwork" BOOLEAN NOT NULL DEFAULT false,
    "wellness" BOOLEAN NOT NULL DEFAULT false,
    "diseaseMgmt" TEXT,
    "av" DOUBLE PRECISION,
    "dedInd" DOUBLE PRECISION,
    "dedFam" DOUBLE PRECISION,
    "drugDed" DOUBLE PRECISION,
    "moopInd" DOUBLE PRECISION,
    "moopFam" DOUBLE PRECISION,
    "coinsurance" DOUBLE PRECISION,
    "sbcBaby" DOUBLE PRECISION,
    "sbcDiabetes" DOUBLE PRECISION,
    "sbcFracture" DOUBLE PRECISION,
    "costShare" JSONB,
    "covered" TEXT[],
    "prem21" DOUBLE PRECISION,
    "prem40" DOUBLE PRECISION,
    "prem60" DOUBLE PRECISION,
    "prem40Min" DOUBLE PRECISION,
    "prem40Max" DOUBLE PRECISION,
    "areaPrem40" JSONB,
    "sbcUrl" TEXT,
    "source" TEXT NOT NULL,

    CONSTRAINT "QhpPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QhpPlan_state_year_market_idx" ON "public"."QhpPlan"("state", "year", "market");

-- CreateIndex
CREATE INDEX "QhpPlan_issuerId_idx" ON "public"."QhpPlan"("issuerId");

-- CreateIndex
CREATE INDEX "QhpPlan_planId_idx" ON "public"."QhpPlan"("planId");
