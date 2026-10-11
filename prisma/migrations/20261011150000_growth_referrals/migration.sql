-- Growth: personal invite codes, referrals and signup source. Idempotent; no data changes.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "inviteCode" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referredById" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "signupSource" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "signupUtm" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "User_inviteCode_key" ON "User"("inviteCode");
CREATE INDEX IF NOT EXISTS "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX IF NOT EXISTS "User_referredById_idx" ON "User"("referredById");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_referredById_fkey') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey"
      FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
