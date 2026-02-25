-- AlterTable
ALTER TABLE "Challenge" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'most',
ADD COLUMN     "targetReps" INTEGER;
