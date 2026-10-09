-- Schema drift fixes (D1–D3). Idempotent: production already has these objects.

-- D1: "User"."isAdmin" exists in schema.prisma but no migration created it.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- D2: index created in 20260203150000_user_profile; now declared in the schema (@@index([deletedAt])).
CREATE INDEX IF NOT EXISTS "User_deletedAt_idx" ON "User"("deletedAt");

-- D3: "updatedAt" DEFAULT CURRENT_TIMESTAMP on User/TrainingProgram/TrainingSession/TrainingSet
-- is kept and is now declared in the schema as @default(now()) @updatedAt — nothing to change in SQL.
