/*
  Warnings:

  - You are about to drop the column `status` on the `Friendship` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `Workout` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId,friendId]` on the table `Friendship` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Friendship" DROP COLUMN "status";

-- AlterTable
ALTER TABLE "Workout" DROP COLUMN "createdAt";

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_userId_friendId_key" ON "Friendship"("userId", "friendId");
