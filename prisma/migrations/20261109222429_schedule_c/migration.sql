-- CreateTable
CREATE TABLE "public"."EmployerProvider" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ein" TEXT,
    "relation" TEXT,
    "codes" TEXT[],
    "role" TEXT NOT NULL,
    "carrier" TEXT,
    "directComp" DOUBLE PRECISION,

    CONSTRAINT "EmployerProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployerProvider_planId_idx" ON "public"."EmployerProvider"("planId");

-- CreateIndex
CREATE INDEX "EmployerProvider_carrier_idx" ON "public"."EmployerProvider"("carrier");

-- AddForeignKey
ALTER TABLE "public"."EmployerProvider" ADD CONSTRAINT "EmployerProvider_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."EmployerPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
