-- CreateEnum
CREATE TYPE "Hobby" AS ENUM ('rest', 'workout', 'self_development');

-- CreateEnum
CREATE TYPE "VoteStatus" AS ENUM ('open', 'closed');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hobby" "Hobby" NOT NULL DEFAULT 'rest',
    "workStartTime" TEXT NOT NULL DEFAULT '09:00',
    "lunchTime" TEXT NOT NULL DEFAULT '12:30',
    "workEndTime" TEXT NOT NULL DEFAULT '18:00',
    "allergies" TEXT,
    "companyId" TEXT,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lunch_votes" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '오늘 점심 뭐 먹지?',
    "status" "VoteStatus" NOT NULL DEFAULT 'open',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lunch_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lunch_vote_options" (
    "id" TEXT NOT NULL,
    "lunchVoteId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lunch_vote_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lunch_vote_option_votes" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lunch_vote_option_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emotion_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emotion" TEXT NOT NULL,
    "note" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emotion_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teams_companyId_name_key" ON "teams"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_teamId_idx" ON "users"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "lunch_votes_teamId_status_idx" ON "lunch_votes"("teamId", "status");

-- CreateIndex
CREATE INDEX "lunch_vote_options_lunchVoteId_idx" ON "lunch_vote_options"("lunchVoteId");

-- CreateIndex
CREATE UNIQUE INDEX "lunch_vote_option_votes_optionId_userId_key" ON "lunch_vote_option_votes"("optionId", "userId");

-- CreateIndex
CREATE INDEX "emotion_logs_userId_loggedAt_idx" ON "emotion_logs"("userId", "loggedAt");

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lunch_votes" ADD CONSTRAINT "lunch_votes_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lunch_vote_options" ADD CONSTRAINT "lunch_vote_options_lunchVoteId_fkey" FOREIGN KEY ("lunchVoteId") REFERENCES "lunch_votes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lunch_vote_option_votes" ADD CONSTRAINT "lunch_vote_option_votes_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "lunch_vote_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lunch_vote_option_votes" ADD CONSTRAINT "lunch_vote_option_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emotion_logs" ADD CONSTRAINT "emotion_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
