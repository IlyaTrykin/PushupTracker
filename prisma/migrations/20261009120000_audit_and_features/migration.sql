-- Audit fixes and new features: all schema changes in one idempotent migration.
-- Safe to re-run: every statement is guarded (IF NOT EXISTS / DO blocks / WHERE filters).

-- ---------------------------------------------------------------------------
-- User: time zone, daily goal, Telegram link
-- ---------------------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "timeZone" TEXT NOT NULL DEFAULT 'Europe/Moscow';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dailyGoalPoints" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dailyReminderTime" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "telegramChatId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "telegramLinkedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "User_telegramChatId_key" ON "User"("telegramChatId");

-- Emails are compared case-insensitively from now on (B14).
UPDATE "User" SET "email" = lower(trim("email")) WHERE "email" <> lower(trim("email"));

-- ---------------------------------------------------------------------------
-- Session: store SHA-256 of the token instead of the token (S11).
-- Existing sessions keep working: the cookie token hashes to the backfilled value.
-- ---------------------------------------------------------------------------
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "tokenHash" TEXT;
UPDATE "Session"
SET "tokenHash" = encode(sha256(convert_to("token", 'UTF8')), 'hex')
WHERE "tokenHash" IS NULL AND "token" IS NOT NULL;
ALTER TABLE "Session" ALTER COLUMN "tokenHash" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Session_tokenHash_key" ON "Session"("tokenHash");
ALTER TABLE "Session" ALTER COLUMN "token" DROP NOT NULL;
UPDATE "Session" SET "token" = NULL WHERE "token" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Workout: cardio duration, idempotent create
-- ---------------------------------------------------------------------------
ALTER TABLE "Workout" ADD COLUMN IF NOT EXISTS "durationSeconds" INTEGER;
ALTER TABLE "Workout" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Workout_userId_clientRequestId_key" ON "Workout"("userId", "clientRequestId");

-- ---------------------------------------------------------------------------
-- TrainingSession: one session per number within a program
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "TrainingSession_programId_sessionNumber_key" ON "TrainingSession"("programId", "sessionNumber");

-- ---------------------------------------------------------------------------
-- NotificationPreference: Telegram channel
-- ---------------------------------------------------------------------------
ALTER TABLE "NotificationPreference" ADD COLUMN IF NOT EXISTS "telegramEnabled" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- New tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "UserAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "exerciseType" TEXT,
    "value" DOUBLE PRECISION,
    "workoutId" TEXT,
    "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uniqueKey" TEXT,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserAchievement_uniqueKey_key" ON "UserAchievement"("uniqueKey");
CREATE INDEX IF NOT EXISTS "UserAchievement_userId_achievedAt_idx" ON "UserAchievement"("userId", "achievedAt");

CREATE TABLE IF NOT EXISTS "GroupGoal" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "targetPoints" INTEGER NOT NULL,
    "exerciseType" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "GroupGoal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GroupGoal_groupId_idx" ON "GroupGoal"("groupId");

CREATE TABLE IF NOT EXISTS "TelegramLinkCode" (
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("code")
);

CREATE TABLE IF NOT EXISTS "FriendRequestCooldown" (
    "requesterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "declinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendRequestCooldown_pkey" PRIMARY KEY ("requesterId", "targetId")
);

CREATE TABLE IF NOT EXISTS "NotificationDispatch" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDispatch_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- ---------------------------------------------------------------------------
-- Foreign keys (guarded: ADD CONSTRAINT has no IF NOT EXISTS)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserAchievement_userId_fkey') THEN
    ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserAchievement_workoutId_fkey') THEN
    ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_workoutId_fkey"
      FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GroupGoal_groupId_fkey') THEN
    ALTER TABLE "GroupGoal" ADD CONSTRAINT "GroupGoal_groupId_fkey"
      FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TelegramLinkCode_userId_fkey') THEN
    ALTER TABLE "TelegramLinkCode" ADD CONSTRAINT "TelegramLinkCode_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
