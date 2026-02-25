-- Add time column to Workout
ALTER TABLE "Workout" ADD COLUMN "time" TIMESTAMP(3);

-- Backfill existing rows: use the same day as "date" (midnight)
UPDATE "Workout" SET "time" = "date" WHERE "time" IS NULL;

-- Set NOT NULL and default for new rows
ALTER TABLE "Workout" ALTER COLUMN "time" SET NOT NULL;
ALTER TABLE "Workout" ALTER COLUMN "time" SET DEFAULT CURRENT_TIMESTAMP;
