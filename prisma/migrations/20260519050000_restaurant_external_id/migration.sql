-- AlterTable
ALTER TABLE "restaurants"
  ADD COLUMN "address" TEXT,
  ADD COLUMN "externalId" TEXT;

-- CreateIndex (composite unique). NULL은 중복으로 카운트되지 않으므로 시드 데이터에 영향 없음.
CREATE UNIQUE INDEX "restaurants_source_externalId_key"
  ON "restaurants"("source", "externalId");
