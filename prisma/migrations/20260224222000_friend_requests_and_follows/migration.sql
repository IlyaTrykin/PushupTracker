-- AlterTable
ALTER TABLE "Friendship" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'accepted';

-- CreateTable
CREATE TABLE "FriendFollow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "friendId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendFollow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FriendFollow_followerId_friendId_key" ON "FriendFollow"("followerId", "friendId");
CREATE INDEX "FriendFollow_friendId_idx" ON "FriendFollow"("friendId");

-- AddForeignKey
ALTER TABLE "FriendFollow" ADD CONSTRAINT "FriendFollow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FriendFollow" ADD CONSTRAINT "FriendFollow_friendId_fkey" FOREIGN KEY ("friendId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
