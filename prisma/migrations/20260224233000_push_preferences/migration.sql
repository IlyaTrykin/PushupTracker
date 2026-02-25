-- AlterTable
ALTER TABLE "User"
ADD COLUMN "pushFriendRequest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "pushChallengeInvite" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "pushChallengeRankChange" BOOLEAN NOT NULL DEFAULT true;
