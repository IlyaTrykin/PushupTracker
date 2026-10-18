/**
 * Weekly league among friends (F2): me + accepted friends ranked by points of the week
 * (Monday–Sunday in the viewer's zone). Pure ranking and texts here; the loaders read the
 * database. Used by `GET /api/league`, the friends-page block and the `weekly-league` /
 * `weekly-summary` scheduler jobs.
 */
import {
  addDays,
  dayKeyInZone,
  dayKeyToDbDate,
  diffDays,
  normalizeTimeZone,
  weekStart,
  zonedTimeToInstant,
  type DayKey,
} from './calendar-day';
import { pointsToTenths, tenthsToPoints } from './exercise-points';
import { formatGoalPoints } from './daily-goal';
import { fillLeagueText, leagueMessages, leaguePlaceToken, leaguePointsWord } from '../i18n/messages/features/league';
import type { LocalizedMessage, NotifyLocale } from './notify';
import { loadBlockedPeerIds, type BlockReadDb } from './blocks';

export type LeagueEntry = { userId: string; points: number };
export type LeagueRow = { userId: string; points: number; place: number };
export type League = {
  rows: LeagueRow[];
  /** `null` when `meId` is not among the entries. */
  myPlace: number | null;
  /** Points to the nearest place above mine; `null` for the leader. */
  gapToNext: number | null;
  /** The place `gapToNext` leads to. */
  nextPlace: number | null;
};

/** Ranks entries by points; equal points share a place (1, 1, 3). Compared in tenths, so 0.1 + 0.2 ties with 0.3. */
export function buildLeague(entries: LeagueEntry[], meId: string): League {
  const scored = entries
    .map((entry) => ({ userId: entry.userId, tenths: pointsToTenths(entry.points) }))
    .sort((a, b) => b.tenths - a.tenths || a.userId.localeCompare(b.userId));

  const rows: LeagueRow[] = [];
  let place = 0;
  scored.forEach((entry, index) => {
    if (index === 0 || entry.tenths < scored[index - 1].tenths) place = index + 1;
    rows.push({ userId: entry.userId, points: tenthsToPoints(entry.tenths), place });
  });

  const me = rows.find((row) => row.userId === meId);
  if (!me || me.place === 1) return { rows, myPlace: me?.place ?? null, gapToNext: null, nextPlace: null };

  // The nearest row above me is the last one of the next better place.
  const above = [...rows].reverse().find((row) => row.place < me.place)!;
  return {
    rows,
    myPlace: me.place,
    gapToNext: tenthsToPoints(pointsToTenths(above.points) - pointsToTenths(me.points)),
    nextPlace: above.place,
  };
}

export type LeagueWeek = 'current' | 'previous';

export function parseLeagueWeek(raw: unknown): LeagueWeek {
  return raw === 'previous' ? 'previous' : 'current';
}

/** Monday–Sunday of the current or the previous week around `today`. */
export function leagueWeekRange(today: DayKey, week: LeagueWeek): { start: DayKey; end: DayKey } {
  const start = week === 'previous' ? addDays(weekStart(today), -7) : weekStart(today);
  return { start, end: addDays(start, 6) };
}

export const WEEKLY_SLOT_WINDOW_MS = 3 * 60 * 60 * 1000;

export type WeeklySlot = { weekday: 'monday' | 'sunday'; time: string };

/**
 * The user's day when `now` is inside [slot time, +3 h) of the slot weekday in `timeZone`, else `null`.
 * The window is wider than a tick on purpose: a restart of the server must not lose the notice
 * (the dedupe key still lets it through once).
 */
export function weeklySlotDay(timeZone: string, now: Date, slot: WeeklySlot): DayKey | null {
  const zone = normalizeTimeZone(timeZone);
  const day = dayKeyInZone(now, zone);
  if (diffDays(day, weekStart(day)) !== (slot.weekday === 'monday' ? 0 : 6)) return null;
  const from = zonedTimeToInstant(day, slot.time, zone).getTime();
  const at = now.getTime();
  return at >= from && at < from + WEEKLY_SLOT_WINDOW_MS ? day : null;
}

export const WEEKLY_LEAGUE_SLOT: WeeklySlot = { weekday: 'monday', time: '09:00' };

export function weeklyLeagueKey(userId: string, start: DayKey): string {
  return `weekly-league:${userId}:${start}`;
}

// ---------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------

export const placeToken = leaguePlaceToken;
export const pointsWord = leaguePointsWord;

/** `weekly_league`: «Ты 2-й из 5: 120 баллов за неделю.» */
export function weeklyLeagueMessage(
  locale: NotifyLocale,
  args: { place: number; total: number; points: number },
): LocalizedMessage {
  const text = leagueMessages[locale].league;
  return {
    title: text.title,
    body: fillLeagueText(args.place === 1 ? text.bodyWinner : text.body, {
      place: placeToken(args.place, locale),
      total: args.total,
      points: formatGoalPoints(args.points, locale),
      pointsWord: pointsWord(args.points, locale),
    }),
    link: '/friends',
  };
}

// ---------------------------------------------------------------------------
// Database loaders (Prisma is imported lazily, so the pure part loads without it)
// ---------------------------------------------------------------------------

async function db() {
  return (await import('./prisma')).prisma;
}

/** The part of Prisma `loadFriendIds` reads (`prisma` fits as is). */
export type LeagueFriendsDb = BlockReadDb & {
  friendship: {
    findMany(args: {
      where: { status: 'accepted'; OR: Array<{ userId: string } | { friendId: string }> };
      select: { userId: true; friendId: true };
    }): Promise<Array<{ userId: string; friendId: string }>>;
  };
  user: {
    findMany(args: { where: { id: { in: string[] }; deletedAt: null }; select: { id: true } }): Promise<Array<{ id: string }>>;
  };
};

/** Accepted friends in either direction; soft-deleted and blocked (either way) users left out. */
export async function loadFriendIds(userId: string, client?: LeagueFriendsDb): Promise<string[]> {
  const prisma: LeagueFriendsDb = client ?? (await db());
  const links = await prisma.friendship.findMany({
    where: { status: 'accepted', OR: [{ userId }, { friendId: userId }] },
    select: { userId: true, friendId: true },
  });
  const linked = [...new Set(links.map((link) => (link.userId === userId ? link.friendId : link.userId)))];
  // Blocked in either direction (R33.1): not in the league, the weekly notices or the feed.
  const blocked = await loadBlockedPeerIds(prisma, userId, linked);
  const ids = linked.filter((id) => !blocked.has(id));
  if (!ids.length) return [];
  const active = await prisma.user.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } });
  const activeIds = new Set(active.map((user) => user.id));
  return ids.filter((id) => activeIds.has(id));
}

/** Points of each user for the days start..end (inclusive), 0 for users without workouts. */
export async function loadWeekPoints(userIds: string[], start: DayKey, end: DayKey): Promise<Map<string, number>> {
  const { dayPointsTotal } = await import('./day-stats');
  const prisma = await db();
  const workouts = await prisma.workout.findMany({
    where: { userId: { in: userIds }, date: { gte: dayKeyToDbDate(start), lte: dayKeyToDbDate(end) } },
    select: { userId: true, date: true, reps: true, exerciseType: true, loadKg: true },
  });
  const byUser = new Map<string, typeof workouts>();
  for (const workout of workouts) byUser.set(workout.userId, [...(byUser.get(workout.userId) ?? []), workout]);
  return new Map(userIds.map((id) => [id, dayPointsTotal(byUser.get(id) ?? [])]));
}

/** Me + accepted friends with their points of the week that starts on `start`. */
export async function loadLeagueEntries(userId: string, start: DayKey): Promise<LeagueEntry[]> {
  const ids = [userId, ...(await loadFriendIds(userId))];
  const points = await loadWeekPoints(ids, start, addDays(start, 6));
  return ids.map((id) => ({ userId: id, points: points.get(id) ?? 0 }));
}

/** Users of the app that can get weekly notices: active, with their zone. */
export async function findWeeklyUsers(): Promise<Array<{ id: string; timeZone: string }>> {
  const prisma = await db();
  return prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, timeZone: true } });
}
