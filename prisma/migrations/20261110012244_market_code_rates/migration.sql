-- CreateTable
CREATE TABLE "public"."MarketCodeRate" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "carrierName" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "codeType" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "billingClass" TEXT NOT NULL,
    "providers" INTEGER NOT NULL,
    "p25" DOUBLE PRECISION NOT NULL,
    "median" DOUBLE PRECISION NOT NULL,
    "p75" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MarketCodeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketCodeRate_codeType_code_idx" ON "public"."MarketCodeRate"("codeType", "code");

-- CreateIndex
CREATE INDEX "MarketCodeRate_state_billingClass_idx" ON "public"."MarketCodeRate"("state", "billingClass");
