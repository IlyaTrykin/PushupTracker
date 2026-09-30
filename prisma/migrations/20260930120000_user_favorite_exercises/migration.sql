-- AlterTable
ALTER TABLE "User" ADD COLUMN "favoriteExercises" TEXT[] DEFAULT ARRAY[]::TEXT[];
