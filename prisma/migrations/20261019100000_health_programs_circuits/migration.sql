-- Сборка 2026-10-19: калории и данные тела, программы для всех упражнений, круговые тренировки.
-- Только новые столбцы (все допускают NULL или имеют значение по умолчанию) и новая таблица;
-- существующие строки не меняются. Идемпотентно: можно применить дважды.

-- Данные тела: рост, когда и откуда менялись вес/рост ('manual' | 'health').
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "heightCm" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "weightUpdatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "heightUpdatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "weightSource" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "heightSource" TEXT;

-- Активная энергия тренировки, ккал.
ALTER TABLE "Workout" ADD COLUMN IF NOT EXISTS "activeKcal" DOUBLE PRECISION;

-- Программы: вид ('single' | 'circuit'), вес снаряда, план круговой.
ALTER TABLE "TrainingProgram" ADD COLUMN IF NOT EXISTS "programType" TEXT NOT NULL DEFAULT 'single';
ALTER TABLE "TrainingProgram" ADD COLUMN IF NOT EXISTS "loadKg" DOUBLE PRECISION;
ALTER TABLE "TrainingProgram" ADD COLUMN IF NOT EXISTS "circuitPlanId" TEXT;

-- Занятия: день плана круговой, вид занятия дистанции, шаблон круга.
ALTER TABLE "TrainingSession" ADD COLUMN IF NOT EXISTS "dayLabel" TEXT;
ALTER TABLE "TrainingSession" ADD COLUMN IF NOT EXISTS "sessionKind" TEXT;
ALTER TABLE "TrainingSession" ADD COLUMN IF NOT EXISTS "circuitTemplateId" TEXT;

-- Подходы: своё упражнение, вес, круг/станция, факт по сторонам, время дистанции.
ALTER TABLE "TrainingSet" ADD COLUMN IF NOT EXISTS "exerciseType" TEXT;
ALTER TABLE "TrainingSet" ADD COLUMN IF NOT EXISTS "loadKg" DOUBLE PRECISION;
ALTER TABLE "TrainingSet" ADD COLUMN IF NOT EXISTS "round" INTEGER;
ALTER TABLE "TrainingSet" ADD COLUMN IF NOT EXISTS "station" INTEGER;
ALTER TABLE "TrainingSet" ADD COLUMN IF NOT EXISTS "actualLeft" INTEGER;
ALTER TABLE "TrainingSet" ADD COLUMN IF NOT EXISTS "actualRight" INTEGER;
ALTER TABLE "TrainingSet" ADD COLUMN IF NOT EXISTS "actualSeconds" INTEGER;

-- Свои круги пользователя.
CREATE TABLE IF NOT EXISTS "CustomCircuit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stations" JSONB NOT NULL,
    "rounds" INTEGER NOT NULL,
    "restStationSec" INTEGER NOT NULL,
    "restRoundSec" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomCircuit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CustomCircuit_userId_idx" ON "CustomCircuit"("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomCircuit_userId_fkey') THEN
    ALTER TABLE "CustomCircuit" ADD CONSTRAINT "CustomCircuit_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
