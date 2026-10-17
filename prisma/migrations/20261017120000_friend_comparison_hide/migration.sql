-- Friends a user hid from their comparison table on /friends (the friendship itself stays). Idempotent; no data changes.
CREATE TABLE IF NOT EXISTS "FriendComparisonHide" (
    "userId" TEXT NOT NULL,
    "friendId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendComparisonHide_pkey" PRIMARY KEY ("userId", "friendId")
);

CREATE INDEX IF NOT EXISTS "FriendComparisonHide_friendId_idx" ON "FriendComparisonHide"("friendId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FriendComparisonHide_userId_fkey') THEN
    ALTER TABLE "FriendComparisonHide" ADD CONSTRAINT "FriendComparisonHide_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FriendComparisonHide_friendId_fkey') THEN
    ALTER TABLE "FriendComparisonHide" ADD CONSTRAINT "FriendComparisonHide_friendId_fkey"
      FOREIGN KEY ("friendId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
