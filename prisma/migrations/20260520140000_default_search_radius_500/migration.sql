-- AlterTable: 신규 팀의 기본 검색 반경을 500m로 낮춘다.
-- (800m는 도보로 멀어서 "점심 시간에 다녀올 수 있는 거리" 범위에서 벗어나는 경우가 많았다.)
ALTER TABLE "teams" ALTER COLUMN "searchRadiusMeters" SET DEFAULT 500;

-- 기존에 default(800) 로 만들어진 팀들도 새 기본값을 따라가도록 일괄 업데이트한다.
-- 사용자가 마이페이지에서 명시적으로 다른 값으로 바꿔 둔 경우(예: 700)는 건드리지 않는다.
UPDATE "teams" SET "searchRadiusMeters" = 500 WHERE "searchRadiusMeters" = 800;
