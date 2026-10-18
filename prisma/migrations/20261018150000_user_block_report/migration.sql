-- Reports and blocking (R33): "UserBlock" — who blocked whom (one row per pair and direction),
-- "UserReport" — reports on users, read by the admin. New tables only; existing rows are not touched.
-- Idempotent: safe to apply twice.
CREATE TABLE IF NOT EXISTS "UserBlock" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerId", "blockedId")
);

CREATE INDEX IF NOT EXISTS "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");

CREATE TABLE IF NOT EXISTS "UserReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "contextId" TEXT,
    "reason" TEXT NOT NULL,
    "text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserReport_status_createdAt_idx" ON "UserReport"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "UserReport_targetUserId_idx" ON "UserReport"("targetUserId");
CREATE INDEX IF NOT EXISTS "UserReport_reporterId_createdAt_idx" ON "UserReport"("reporterId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserBlock_blockerId_fkey') THEN
    ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey"
      FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserBlock_blockedId_fkey') THEN
    ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey"
      FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserReport_reporterId_fkey') THEN
    ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_reporterId_fkey"
      FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserReport_targetUserId_fkey') THEN
    ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_targetUserId_fkey"
      FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
