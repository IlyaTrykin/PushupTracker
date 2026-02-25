-- Stage 4: indexes + cascade deletes (no data loss)

-- 1) Add indexes for faster queries
CREATE INDEX IF NOT EXISTS "Workout_userId_exerciseType_time_idx" ON "Workout"("userId", "exerciseType", "time");
CREATE INDEX IF NOT EXISTS "Workout_userId_time_idx" ON "Workout"("userId", "time");
CREATE INDEX IF NOT EXISTS "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- 2) Update foreign keys to cascade on user delete
-- Workout.userId -> User.id
ALTER TABLE "Workout" DROP CONSTRAINT IF EXISTS "Workout_userId_fkey";
ALTER TABLE "Workout"
  ADD CONSTRAINT "Workout_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Session.userId -> User.id
ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_userId_fkey";
ALTER TABLE "Session"
  ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Friendship.userId -> User.id
ALTER TABLE "Friendship" DROP CONSTRAINT IF EXISTS "Friendship_userId_fkey";
ALTER TABLE "Friendship"
  ADD CONSTRAINT "Friendship_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Friendship.friendId -> User.id
ALTER TABLE "Friendship" DROP CONSTRAINT IF EXISTS "Friendship_friendId_fkey";
ALTER TABLE "Friendship"
  ADD CONSTRAINT "Friendship_friendId_fkey"
  FOREIGN KEY ("friendId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
