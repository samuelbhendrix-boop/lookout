CREATE TABLE "SelfFundedLives" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "groupName" TEXT,
    "lives" DOUBLE PRECISION NOT NULL,
    "memberMonths" DOUBLE PRECISION,
    "fees" DOUBLE PRECISION,
    "basis" TEXT NOT NULL,
    "note" TEXT,
    CONSTRAINT "SelfFundedLives_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SelfFundedLives_year_state_company_basis_key" ON "SelfFundedLives"("year", "state", "company", "basis");
CREATE INDEX "SelfFundedLives_state_year_idx" ON "SelfFundedLives"("state", "year");
