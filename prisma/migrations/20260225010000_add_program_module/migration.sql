-- Add program module tables and workout linkage

ALTER TABLE "Workout"
ADD COLUMN "trainingSessionId" TEXT;

CREATE TABLE "TrainingProgram" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "exerciseType" TEXT NOT NULL,
  "goalType" TEXT NOT NULL,
  "targetReps" INTEGER,
  "durationWeeks" INTEGER NOT NULL,
  "frequencyPerWeek" INTEGER NOT NULL,
  "baselineMaxReps" INTEGER NOT NULL,
  "ageYears" INTEGER NOT NULL,
  "weightKg" INTEGER NOT NULL,
  "sex" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'active',
  "needsRetest" BOOLEAN NOT NULL DEFAULT false,
  "lastRecalculatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isActive" BOOLEAN NOT NULL DEFAULT true,

  CONSTRAINT "TrainingProgram_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSession" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "weekNumber" INTEGER NOT NULL,
  "sessionNumber" INTEGER NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TIMESTAMP(3),
  "shiftedCount" INTEGER NOT NULL DEFAULT 0,
  "reminderSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSet" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "setNumber" INTEGER NOT NULL,
  "targetReps" INTEGER NOT NULL,
  "actualReps" INTEGER,
  "restSeconds" INTEGER NOT NULL,
  "completedAt" TIMESTAMP(3),
  "isKeySet" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TrainingSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrainingSet_sessionId_setNumber_key" ON "TrainingSet"("sessionId", "setNumber");
CREATE INDEX "Workout_trainingSessionId_idx" ON "Workout"("trainingSessionId");
CREATE INDEX "TrainingProgram_userId_isActive_createdAt_idx" ON "TrainingProgram"("userId", "isActive", "createdAt");
CREATE INDEX "TrainingSession_programId_scheduledAt_idx" ON "TrainingSession"("programId", "scheduledAt");
CREATE INDEX "TrainingSession_programId_completed_scheduledAt_idx" ON "TrainingSession"("programId", "completed", "scheduledAt");
CREATE INDEX "TrainingSet_sessionId_setNumber_idx" ON "TrainingSet"("sessionId", "setNumber");

ALTER TABLE "Workout"
ADD CONSTRAINT "Workout_trainingSessionId_fkey"
FOREIGN KEY ("trainingSessionId") REFERENCES "TrainingSession"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TrainingProgram"
ADD CONSTRAINT "TrainingProgram_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrainingSession"
ADD CONSTRAINT "TrainingSession_programId_fkey"
FOREIGN KEY ("programId") REFERENCES "TrainingProgram"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrainingSet"
ADD CONSTRAINT "TrainingSet_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
