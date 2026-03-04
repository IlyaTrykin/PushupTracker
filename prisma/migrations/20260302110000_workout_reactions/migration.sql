CREATE TABLE "WorkoutReaction" (
  "id" TEXT NOT NULL,
  "workoutId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkoutReaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkoutReaction_workoutId_userId_key" ON "WorkoutReaction"("workoutId", "userId");
CREATE INDEX "WorkoutReaction_workoutId_updatedAt_idx" ON "WorkoutReaction"("workoutId", "updatedAt");
CREATE INDEX "WorkoutReaction_userId_idx" ON "WorkoutReaction"("userId");

ALTER TABLE "WorkoutReaction"
  ADD CONSTRAINT "WorkoutReaction_workoutId_fkey"
  FOREIGN KEY ("workoutId") REFERENCES "Workout"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkoutReaction"
  ADD CONSTRAINT "WorkoutReaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
