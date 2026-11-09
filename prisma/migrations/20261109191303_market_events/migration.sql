-- CreateTable
CREATE TABLE "public"."MarketEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "url" TEXT,
    "importance" INTEGER NOT NULL DEFAULT 2,
    "state" TEXT,
    "data" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RateHistory" (
    "carrier" TEXT NOT NULL,
    "carrierName" TEXT NOT NULL,
    "codeType" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "billingClass" TEXT NOT NULL,
    "tin" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "median" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "RateHistory_pkey" PRIMARY KEY ("carrier","codeType","code","billingClass","tin","month")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketEvent_eventKey_key" ON "public"."MarketEvent"("eventKey");

-- CreateIndex
CREATE INDEX "MarketEvent_kind_occurredAt_idx" ON "public"."MarketEvent"("kind", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "MarketEvent_carrier_idx" ON "public"."MarketEvent"("carrier");

-- CreateIndex
CREATE INDEX "RateHistory_month_idx" ON "public"."RateHistory"("month");
