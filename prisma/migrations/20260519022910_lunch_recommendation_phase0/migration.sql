-- CreateEnum
CREATE TYPE "RestaurantCategory" AS ENUM ('korean', 'japanese', 'chinese', 'western', 'asian', 'snack', 'cafe', 'etc');

-- CreateEnum
CREATE TYPE "PriceTier" AS ENUM ('low', 'mid', 'high');

-- CreateEnum
CREATE TYPE "Dietary" AS ENUM ('none', 'vegetarian', 'vegan', 'halal', 'kosher');

-- AlterTable
ALTER TABLE "lunch_vote_options" ADD COLUMN     "restaurantId" TEXT;

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "address" TEXT,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "searchRadiusMeters" INTEGER NOT NULL DEFAULT 800;

-- CreateTable
CREATE TABLE "restaurants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "RestaurantCategory" NOT NULL,
    "priceTier" "PriceTier" NOT NULL DEFAULT 'mid',
    "rating" DOUBLE PRECISION,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "openHours" JSONB,
    "hasRoom" BOOLEAN NOT NULL DEFAULT false,
    "capacity" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedAllergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dietarySupported" "Dietary"[] DEFAULT ARRAY[]::"Dietary"[],
    "source" TEXT NOT NULL DEFAULT 'seed',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "lunchVoteId" TEXT,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rating" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preferredCategories" "RestaurantCategory"[] DEFAULT ARRAY[]::"RestaurantCategory"[],
    "dislikedCategories" "RestaurantCategory"[] DEFAULT ARRAY[]::"RestaurantCategory"[],
    "budgetMax" INTEGER,
    "spicyTolerance" INTEGER NOT NULL DEFAULT 2,
    "dietary" "Dietary" NOT NULL DEFAULT 'none',
    "fairnessScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurants_category_idx" ON "restaurants"("category");

-- CreateIndex
CREATE INDEX "visit_records_userId_visitedAt_idx" ON "visit_records"("userId", "visitedAt");

-- CreateIndex
CREATE INDEX "visit_records_restaurantId_visitedAt_idx" ON "visit_records"("restaurantId", "visitedAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_userId_key" ON "user_preferences"("userId");

-- CreateIndex
CREATE INDEX "lunch_vote_options_restaurantId_idx" ON "lunch_vote_options"("restaurantId");

-- AddForeignKey
ALTER TABLE "lunch_vote_options" ADD CONSTRAINT "lunch_vote_options_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_records" ADD CONSTRAINT "visit_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_records" ADD CONSTRAINT "visit_records_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_records" ADD CONSTRAINT "visit_records_lunchVoteId_fkey" FOREIGN KEY ("lunchVoteId") REFERENCES "lunch_votes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
