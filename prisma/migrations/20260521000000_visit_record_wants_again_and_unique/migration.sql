-- AlterTable: VisitRecord에 wantsAgain 컬럼 추가 + 같은 투표에 중복 리뷰 방지 유니크 제약
ALTER TABLE "visit_records" ADD COLUMN "wantsAgain" BOOLEAN;

-- 한 사용자가 같은 투표에 대해 한 번만 리뷰 가능.
-- lunchVoteId가 NULL인 수동 기록은 이 제약에 걸리지 않는다(PG unique은 NULL을 중복 허용).
CREATE UNIQUE INDEX "visit_records_userId_lunchVoteId_key"
  ON "visit_records"("userId", "lunchVoteId");
