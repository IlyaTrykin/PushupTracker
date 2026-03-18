CREATE TABLE "WorkoutReward" (
  "id" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "minPointsTenths" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkoutReward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkoutReward_minPointsTenths_key" ON "WorkoutReward"("minPointsTenths");
CREATE INDEX "WorkoutReward_minPointsTenths_idx" ON "WorkoutReward"("minPointsTenths");

INSERT INTO "WorkoutReward" ("id", "message", "minPointsTenths", "createdAt", "updatedAt")
VALUES
  ('reward_thumb', '👍', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('reward_double_thumb', '👍👍', 210, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('reward_machine', 'МАШИНА!!!! 💪🎉', 500, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
