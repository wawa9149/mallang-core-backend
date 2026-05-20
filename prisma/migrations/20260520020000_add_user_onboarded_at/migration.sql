-- AlterTable: 온보딩 완료 시점을 박는 컬럼. nullable 이며 한 번 채워지면 다시 null 로 돌리지 않는다.
ALTER TABLE "users"
  ADD COLUMN "onboardedAt" TIMESTAMP(3);

-- Backfill: 마이그레이션 직전 이미 name + teamId 가 모두 채워진 사용자는 사실상 온보딩을 마친 상태다.
-- onboardedAt 을 updatedAt 시점으로 박아 두어, 마이그레이션 직후 다시 온보딩 화면이 뜨는 일이 없도록 한다.
UPDATE "users"
  SET "onboardedAt" = "updatedAt"
  WHERE COALESCE(TRIM("name"), '') <> ''
    AND "teamId" IS NOT NULL;
