-- CreateTable
CREATE TABLE "public"."RateFile" (
    "id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "carrierName" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "reportingEntity" TEXT,
    "lastUpdated" TEXT,
    "stats" JSONB,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "RateFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RateSummary" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeType" TEXT NOT NULL,
    "billingClass" TEXT NOT NULL,
    "negotiatedType" TEXT NOT NULL,
    "providers" INTEGER NOT NULL,
    "p10" DOUBLE PRECISION NOT NULL,
    "p25" DOUBLE PRECISION NOT NULL,
    "p50" DOUBLE PRECISION NOT NULL,
    "p75" DOUBLE PRECISION NOT NULL,
    "p90" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "RateSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProviderRate" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeType" TEXT NOT NULL,
    "billingClass" TEXT NOT NULL,
    "negotiatedType" TEXT NOT NULL,
    "tin" TEXT NOT NULL,
    "providerName" TEXT,
    "npiCount" INTEGER NOT NULL,
    "n" INTEGER NOT NULL,
    "min" DOUBLE PRECISION NOT NULL,
    "median" DOUBLE PRECISION NOT NULL,
    "max" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ProviderRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateSummary_codeType_code_idx" ON "public"."RateSummary"("codeType", "code");

-- CreateIndex
CREATE INDEX "ProviderRate_codeType_code_billingClass_idx" ON "public"."ProviderRate"("codeType", "code", "billingClass");

-- CreateIndex
CREATE INDEX "ProviderRate_tin_idx" ON "public"."ProviderRate"("tin");

-- AddForeignKey
ALTER TABLE "public"."RateSummary" ADD CONSTRAINT "RateSummary_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "public"."RateFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProviderRate" ADD CONSTRAINT "ProviderRate_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "public"."RateFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
