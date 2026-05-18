/*
  Warnings:

  - The `emotion` column on the `emotion_logs` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "Emotion" AS ENUM ('happy', 'neutral', 'tired', 'sad', 'angry');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "ChatIntent" AS ENUM ('free', 'morning_check', 'lunch_alert', 'lunch_review', 'evening_check');

-- AlterTable
ALTER TABLE "emotion_logs" ADD COLUMN     "chatMessageId" TEXT,
ADD COLUMN     "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "score" INTEGER NOT NULL DEFAULT 50,
DROP COLUMN "emotion",
ADD COLUMN     "emotion" "Emotion" NOT NULL DEFAULT 'neutral';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "openaiKeyEnc" TEXT,
ADD COLUMN     "openaiKeyUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "intent" "ChatIntent" NOT NULL DEFAULT 'free',
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_messages_userId_createdAt_idx" ON "chat_messages"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emotion_logs" ADD CONSTRAINT "emotion_logs_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
