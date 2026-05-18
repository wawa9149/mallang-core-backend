-- AlterTable
ALTER TABLE "lunch_votes" ADD COLUMN     "winnerOptionId" TEXT;

-- CreateIndex
CREATE INDEX "lunch_votes_status_closesAt_idx" ON "lunch_votes"("status", "closesAt");
