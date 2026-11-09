-- CreateTable
CREATE TABLE "public"."HospitalRate" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "tin" TEXT,
    "hospital" TEXT NOT NULL,
    "state" TEXT,
    "codeType" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "setting" TEXT,
    "payer" TEXT NOT NULL,
    "plan" TEXT,
    "carrier" TEXT,
    "product" TEXT,
    "dollar" DOUBLE PRECISION,
    "percentage" DOUBLE PRECISION,
    "methodology" TEXT,

    CONSTRAINT "HospitalRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HospitalFile" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "hospital" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "state" TEXT,
    "tin" TEXT,
    "lastUpdated" TEXT,
    "version" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "payers" JSONB,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HospitalFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HospitalRate_fileId_idx" ON "public"."HospitalRate"("fileId");

-- CreateIndex
CREATE INDEX "HospitalRate_tin_idx" ON "public"."HospitalRate"("tin");

-- CreateIndex
CREATE INDEX "HospitalRate_carrier_idx" ON "public"."HospitalRate"("carrier");
