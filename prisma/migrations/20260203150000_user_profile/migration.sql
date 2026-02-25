-- AlterTable
ALTER TABLE "User" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "User" ADD COLUMN     "gender" TEXT;
ALTER TABLE "User" ADD COLUMN     "birthDate" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN     "avatarPath" TEXT;
ALTER TABLE "User" ADD COLUMN     "deletedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN     "deletedById" TEXT;

-- CreateTable
CREATE TABLE "UserProfileHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changes" JSONB NOT NULL,

    CONSTRAINT "UserProfileHistory_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserProfileHistory" ADD CONSTRAINT "UserProfileHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserProfileHistory" ADD CONSTRAINT "UserProfileHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");
CREATE INDEX "UserProfileHistory_userId_changedAt_idx" ON "UserProfileHistory"("userId", "changedAt");
