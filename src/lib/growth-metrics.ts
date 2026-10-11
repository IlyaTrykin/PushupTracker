import { addDays, dayKeyInZone, diffDays, weekStart, type DayKey } from '@/lib/calendar-day';

export type GrowthUser = { id: string; createdAt: Date; signupSource: string | null; referredById: string | null };
export type GrowthWorkout = { userId: string; time: Date };

export type Rate = { hit: number; of: number };

export type GrowthReport = {
  totals: { users: number; activated: number; wau: number; mau: number; referred: number; inviters: number };
  signupsByWeek: { week: DayKey; signups: number; referred: number }[];
  sources: { source: string; users: number }[];
  activation: { within24h: Rate; within7d: Rate };
  retention: { week1: Rate; week4: Rate };
};

const DAY_MS = 86_400_000;

/**
 * Growth funnel over plain rows; "today" and weeks are calendar days in `timeZone`.
 * week1 = a workout on days 1–7 after signup (users who signed up ≥8 days ago);
 * week4 = a workout on days 22–28 (users who signed up ≥29 days ago).
 */
export function buildGrowthReport(
  users: GrowthUser[],
  workouts: GrowthWorkout[],
  now: Date,
  timeZone: string,
  weeks = 12,
): GrowthReport {
  const today = dayKeyInZone(now, timeZone);
  const byUser = new Map<string, Date[]>();
  for (const w of workouts) {
    const list = byUser.get(w.userId);
    if (list) list.push(w.time);
    else byUser.set(w.userId, [w.time]);
  }

  const activeSince = (days: number) => {
    const from = now.getTime() - days * DAY_MS;
    let n = 0;
    for (const u of users) if ((byUser.get(u.id) ?? []).some((t) => t.getTime() > from)) n++;
    return n;
  };

  const thisWeek = weekStart(today);
  const signupsByWeek: GrowthReport['signupsByWeek'] = [];
  for (let i = weeks - 1; i >= 0; i--) signupsByWeek.push({ week: addDays(thisWeek, -7 * i), signups: 0, referred: 0 });
  const weekIndex = new Map(signupsByWeek.map((w, i) => [w.week, i]));

  const sourceCounts = new Map<string, number>();
  const within24h: Rate = { hit: 0, of: 0 };
  const within7d: Rate = { hit: 0, of: 0 };
  const week1: Rate = { hit: 0, of: 0 };
  const week4: Rate = { hit: 0, of: 0 };

  for (const u of users) {
    const signupDay = dayKeyInZone(u.createdAt, timeZone);
    const idx = weekIndex.get(weekStart(signupDay));
    if (idx !== undefined) {
      signupsByWeek[idx].signups++;
      if (u.referredById) signupsByWeek[idx].referred++;
    }
    const source = u.signupSource ?? 'unknown';
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);

    const times = byUser.get(u.id) ?? [];
    const ageMs = now.getTime() - u.createdAt.getTime();
    const first = times.length ? Math.min(...times.map((t) => t.getTime())) : null;
    if (ageMs >= DAY_MS) {
      within24h.of++;
      if (first !== null && first - u.createdAt.getTime() <= DAY_MS) within24h.hit++;
    }
    if (ageMs >= 7 * DAY_MS) {
      within7d.of++;
      if (first !== null && first - u.createdAt.getTime() <= 7 * DAY_MS) within7d.hit++;
    }

    const offsets = new Set(times.map((t) => diffDays(dayKeyInZone(t, timeZone), signupDay)));
    const age = diffDays(today, signupDay);
    const anyIn = (from: number, to: number) => [...offsets].some((d) => d >= from && d <= to);
    if (age >= 8) {
      week1.of++;
      if (anyIn(1, 7)) week1.hit++;
    }
    if (age >= 29) {
      week4.of++;
      if (anyIn(22, 28)) week4.hit++;
    }
  }

  const inviters = new Set(users.map((u) => u.referredById).filter((id): id is string => Boolean(id)));
  return {
    totals: {
      users: users.length,
      activated: users.filter((u) => byUser.has(u.id)).length,
      wau: activeSince(7),
      mau: activeSince(30),
      referred: users.filter((u) => u.referredById).length,
      inviters: inviters.size,
    },
    signupsByWeek,
    sources: [...sourceCounts.entries()].map(([source, n]) => ({ source, users: n })).sort((a, b) => b.users - a.users),
    activation: { within24h, within7d },
    retention: { week1, week4 },
  };
}

export function ratePercent(r: Rate): number | null {
  return r.of ? Math.round((r.hit / r.of) * 100) : null;
}
