-- AlterTable: 말랑이 발화 TTS 사용 여부. 기본은 꺼져 있고, 마이페이지에서 토글한다.
ALTER TABLE "users"
  ADD COLUMN "ttsEnabled" BOOLEAN NOT NULL DEFAULT false;
