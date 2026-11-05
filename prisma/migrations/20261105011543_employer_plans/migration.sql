-- CreateTable
CREATE TABLE "public"."EmployerPlan" (
    "id" TEXT NOT NULL,
    "ackId" TEXT NOT NULL,
    "formYear" INTEGER NOT NULL,
    "ein" TEXT NOT NULL,
    "planNum" TEXT NOT NULL,
    "sponsor" TEXT NOT NULL,
    "dba" TEXT,
    "city" TEXT,
    "state" TEXT NOT NULL,
    "zip" TEXT,
    "naics" TEXT,
    "planName" TEXT NOT NULL,
    "planYearBegin" TIMESTAMP(3) NOT NULL,
    "participants" INTEGER,
    "funding" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "EmployerPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmployerContract" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "carrierNaic" TEXT,
    "contractNum" TEXT,
    "personsCovered" INTEGER,
    "premium" DOUBLE PRECISION,
    "claims" DOUBLE PRECISION,
    "brokerComm" DOUBLE PRECISION,
    "brokerFees" DOUBLE PRECISION,
    "policyFrom" TIMESTAMP(3),
    "policyTo" TIMESTAMP(3),
    "hmo" BOOLEAN NOT NULL DEFAULT false,
    "ppo" BOOLEAN NOT NULL DEFAULT false,
    "brokers" JSONB,

    CONSTRAINT "EmployerContract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployerPlan_ackId_key" ON "public"."EmployerPlan"("ackId");

-- CreateIndex
CREATE INDEX "EmployerPlan_state_planYearBegin_idx" ON "public"."EmployerPlan"("state", "planYearBegin");

-- CreateIndex
CREATE INDEX "EmployerPlan_ein_planNum_idx" ON "public"."EmployerPlan"("ein", "planNum");

-- CreateIndex
CREATE INDEX "EmployerPlan_sponsor_idx" ON "public"."EmployerPlan"("sponsor");

-- CreateIndex
CREATE INDEX "EmployerContract_carrier_idx" ON "public"."EmployerContract"("carrier");

-- CreateIndex
CREATE INDEX "EmployerContract_planId_idx" ON "public"."EmployerContract"("planId");

-- AddForeignKey
ALTER TABLE "public"."EmployerContract" ADD CONSTRAINT "EmployerContract_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."EmployerPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Curated issuer patterns now live in code (and improve each release). Clear copies that starter
-- packs saved on competitors so they fall back to the curated version; user-customized patterns stay.
UPDATE "Competitor" SET "issuerPattern" = NULL WHERE "issuerPattern" IN (
  'harvard pilgrim|hphc|tufts (associated|insurance|health)',
  'unitedhealthcare|united healthcare',
  'aetna',
  'cigna|connecticut general life',
  'anthem|matthew thornton|elevance|empire healthchoice|healthkeepers|wellpoint',
  'celtic insurance|ambetter|centene|granite state health|health net|wellcare',
  'boston medical center health plan|wellsense',
  'blue cross and blue shield of massachusetts',
  'mass general brigham|allways',
  'fallon',
  'health new england',
  'community health options',
  'taro health|mending health',
  'blue cross.*rhode island',
  'neighborhood health plan of rhode island',
  'humana', 'molina', 'oscar', 'kaiser', 'health care service corp'
);
