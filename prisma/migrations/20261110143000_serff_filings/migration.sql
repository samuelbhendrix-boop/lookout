-- CreateTable
CREATE TABLE "public"."SerffFiling" (
    "id" TEXT NOT NULL,
    "tracking" TEXT NOT NULL,
    "state" TEXT,
    "company" TEXT,
    "toi" TEXT,
    "subToi" TEXT,
    "market" TEXT,
    "filingType" TEXT,
    "productName" TEXT,
    "planYear" INTEGER,
    "submitted" TIMESTAMP(3),
    "disposition" TEXT,
    "dispositionAt" TIMESTAMP(3),
    "newProduct" BOOLEAN NOT NULL DEFAULT false,
    "rateChange" DOUBLE PRECISION,
    "summary" TEXT,
    "detail" JSONB,
    "files" JSONB,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SerffFiling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SerffNetworkAccess" (
    "id" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "state" TEXT,
    "county" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "members" INTEGER,
    "withAccess" INTEGER,
    "pct" DOUBLE PRECISION,

    CONSTRAINT "SerffNetworkAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SerffCrosswalk" (
    "id" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "fromPlan" TEXT NOT NULL,
    "toPlan" TEXT,
    "reason" TEXT,
    "level" TEXT,

    CONSTRAINT "SerffCrosswalk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SerffFiling_tracking_key" ON "public"."SerffFiling"("tracking");

-- CreateIndex
CREATE INDEX "SerffFiling_state_company_idx" ON "public"."SerffFiling"("state", "company");

-- CreateIndex
CREATE INDEX "SerffNetworkAccess_filingId_idx" ON "public"."SerffNetworkAccess"("filingId");

-- CreateIndex
CREATE INDEX "SerffNetworkAccess_network_county_idx" ON "public"."SerffNetworkAccess"("network", "county");

-- CreateIndex
CREATE INDEX "SerffCrosswalk_filingId_idx" ON "public"."SerffCrosswalk"("filingId");

-- AddForeignKey
ALTER TABLE "public"."SerffNetworkAccess" ADD CONSTRAINT "SerffNetworkAccess_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "public"."SerffFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SerffCrosswalk" ADD CONSTRAINT "SerffCrosswalk_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "public"."SerffFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

