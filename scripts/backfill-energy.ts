/**
 * Досчёт активных калорий (`Workout.activeKcal`) по всей истории — один раз при выкладке.
 *
 *   DATABASE_URL=postgresql://… npx tsx scripts/backfill-energy.ts            # пробный прогон: только посчитать
 *   DATABASE_URL=postgresql://… npx tsx scripts/backfill-energy.ts --apply    # записать
 *   [--batch=100]  пользователей за проход; [--user=<id>] только один пользователь
 *
 * Берёт пользователей с весом (без удалённых), пачками по id; для каждого — `backfillWorkoutEnergy`:
 * только тренировки с пустыми калориями, вес на дату — из истории профиля, иначе текущий.
 * Повторный запуск ничего не меняет. По умолчанию — пробный прогон (`--dry-run`), запись — только с `--apply`.
 * Сначала — на копии базы (см. процедуру выкладки).
 */

export {};

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function loadDotEnv() {
  try {
    process.loadEnvFile('.env');
  } catch {
    // нет .env — считается только окружение оболочки
  }
}

function databaseHost(url: string | undefined): string {
  try {
    return url ? new URL(url).host : 'none';
  } catch {
    return 'invalid';
  }
}

async function main() {
  loadDotEnv();
  const apply = hasFlag('apply');
  if (apply && hasFlag('dry-run')) throw new Error('--apply и --dry-run вместе: выберите одно');
  const batch = Math.max(1, Math.min(1000, Number(arg('batch') || 100) || 100));
  const onlyUser = arg('user');

  const { prisma } = await import('../src/lib/prisma');
  const { backfillWorkoutEnergy } = await import('../src/lib/workout-energy');

  console.log(`Energy backfill on ${databaseHost(process.env.DATABASE_URL)} — ${apply ? 'APPLY (writes)' : 'dry run (no writes)'}`);

  let users = 0;
  let pending = 0;
  let updated = 0;
  let failed = 0;
  let afterId: string | null = null;
  try {
    for (;;) {
      const rows: { id: string }[] = await prisma.user.findMany({
        where: {
          weightKg: { not: null },
          deletedAt: null,
          ...(onlyUser ? { id: onlyUser } : afterId ? { id: { gt: afterId } } : {}),
        },
        orderBy: { id: 'asc' },
        take: batch,
        select: { id: true },
      });
      if (!rows.length) break;
      afterId = rows[rows.length - 1].id;

      for (const { id } of rows) {
        try {
          const result = await backfillWorkoutEnergy(id, { dryRun: !apply });
          users += 1;
          pending += result.pending;
          updated += result.updated;
        } catch (e) {
          failed += 1;
          console.error(`user ${id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      console.log(`… users ${users}, workouts to fill ${pending}, written ${updated}${failed ? `, failed ${failed}` : ''}`);
      if (onlyUser || rows.length < batch) break;
    }

    const left = await prisma.workout.count({ where: { activeKcal: null, user: { weightKg: { not: null }, deletedAt: null } } });
    console.log(`Done: users ${users}, workouts to fill ${pending}, written ${updated}, failed ${failed}; still empty for users with weight: ${left}`);
    if (failed) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
