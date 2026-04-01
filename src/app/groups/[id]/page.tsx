'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { startTransition, useDeferredValue, type CSSProperties, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { PERIOD_OPTIONS } from '@/lib/analytics/constants';
import { buildProgressAnalytics, getExerciseAccent } from '@/lib/analytics/selectors';
import type { ExerciseFilter, HeatmapCell, PeriodKey, WorkoutRecord } from '@/lib/analytics/types';
import { toLoadPoints } from '@/lib/analytics/utils';
import { formatExerciseValue } from '@/lib/exercise-metrics';
import { useI18n } from '@/i18n/provider';
import { getIntlLocale } from '@/i18n/translate';
import { t } from '@/i18n/translate';

type MemberItem = {
  userId: string;
  status: string;
  includeInStats: boolean;
  joinedAt: string;
  isOwner: boolean;
  user: {
    id: string;
    username: string;
    email?: string | null;
    avatarPath?: string | null;
  };
};

type PendingRequest = {
  id: string;
  userId: string;
  status: string;
  createdAt: string;
  user: {
    id: string;
    username: string;
    email?: string | null;
    avatarPath?: string | null;
  };
};

type GroupDetail = {
  id: string;
  name: string;
  ownerId: string;
  canManage: boolean;
  isOwner: boolean;
  inviteToken: string | null;
  inviteUpdatedAt?: string | null;
  members: MemberItem[];
  pendingRequests: PendingRequest[];
};

type GroupWorkout = {
  id: string;
  reps: number;
  date: string;
  time: string | null;
  exerciseType: string;
};

type GroupFeedItem = GroupWorkout & {
  ownerUserId: string;
  ownerUsername: string;
  ownerAvatarPath: string | null;
  occurredAt: number;
};

type WorkoutStats = {
  totalToday: number;
  totalWeek: number;
  totalMonth: number;
  totalAll: number;
  streak: number;
};

type ExerciseType = 'pushups' | 'pullups' | 'crunches' | 'squats' | 'plank';
type WorkoutStatsByExercise = Record<ExerciseType, WorkoutStats>;

type GroupChallenge = {
  id: string;
  name: string;
  exerciseType: string;
  mode: string;
  targetReps: number | null;
  startDate: string;
  endDate: string;
  participants: Array<{
    userId: string;
    status: string;
    user: { username: string };
  }>;
};

type GroupAuditLogItem = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
  actorId: string | null;
  targetUserId: string | null;
  actor?: {
    id: string;
    username: string;
    avatarPath?: string | null;
  } | null;
  targetUser?: {
    id: string;
    username: string;
    avatarPath?: string | null;
  } | null;
};

const EXERCISE_ORDER: ExerciseType[] = ['pushups', 'pullups', 'crunches', 'squats', 'plank'];
const FEED_PERIOD_OPTIONS: PeriodKey[] = ['7d', '30d', '90d', 'all'];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function fetchJsonSafe<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch {}
  }
  if (!res.ok) {
    const message = typeof (data as { error?: unknown })?.error === 'string'
      ? String((data as { error: string }).error)
      : `Ошибка (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

function todayDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function plusDaysString(days: number) {
  const now = new Date();
  now.setDate(now.getDate() + days);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function normalizeDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getWorkoutDate(value: Pick<GroupWorkout, 'time' | 'date'>) {
  return new Date(value.time || value.date);
}

function toExerciseType(type: string | undefined): ExerciseType {
  if (type === 'pullups' || type === 'crunches' || type === 'squats' || type === 'plank') return type;
  return 'pushups';
}

function exerciseFeedIcon(type: ExerciseType): string {
  const v = '20260315-2';
  if (type === 'pushups') return `/icons/exercise-types/feed/pushups.svg?v=${v}`;
  if (type === 'pullups') return `/icons/exercise-types/feed/pullups.svg?v=${v}`;
  if (type === 'crunches') return `/icons/exercise-types/feed/crunches.svg?v=${v}`;
  if (type === 'squats') return `/icons/exercise-types/feed/squats.svg?v=${v}`;
  return `/icons/exercise-types/feed/plank.svg?v=${v}`;
}

function formatDateWithWeekday(dayKey: string, locale: string): string {
  const d = new Date(`${dayKey}T00:00:00`);
  return d.toLocaleDateString(locale, {
    weekday: 'short',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function formatTimeHHMM(iso?: string | null) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const normalized = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getIsoWeekNumber(date: Date): number {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  return Math.ceil((((copy.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function describeAuditAction(tt: (input: string) => string, log: GroupAuditLogItem) {
  const actor = log.actor?.username || tt('Система');
  const target = log.targetUser?.username || tt('участник');

  switch (log.action) {
    case 'group_created':
      return `${actor} ${tt('создал группу')}`;
    case 'group_updated':
      return `${actor} ${tt('обновил название группы')}`;
    case 'group_invite_rotated':
      return `${actor} ${tt('обновил ссылку приглашения')}`;
    case 'group_join_requested':
      return `${target} ${tt('отправил заявку на вступление')}`;
    case 'group_join_approved':
      return `${actor} ${tt('одобрил вступление пользователя')} ${target}`;
    case 'group_join_rejected':
      return `${actor} ${tt('отклонил вступление пользователя')} ${target}`;
    case 'group_left':
      return `${target} ${tt('вышел из группы')}`;
    case 'group_member_removed':
      return `${actor} ${tt('исключил участника')} ${target}`;
    case 'group_owner_transferred':
      return `${actor} ${tt('передал права владельца пользователю')} ${target}`;
    case 'group_deleted':
      return `${actor} ${tt('удалил группу')}`;
    case 'group_member_workout_created':
      return `${actor} ${tt('создал тренировку для участника')} ${target}`;
    case 'group_member_workout_updated':
      return `${actor} ${tt('обновил тренировку участника')} ${target}`;
    case 'group_member_workout_deleted':
      return `${actor} ${tt('удалил тренировку участника')} ${target}`;
    case 'group_member_program_created':
      return `${actor} ${tt('назначил программу участнику')} ${target}`;
    case 'group_member_program_deactivated':
      return `${actor} ${tt('прервал программу участника')} ${target}`;
    case 'group_challenge_created':
      return `${actor} ${tt('создал соревнование группы')}`;
    case 'group_challenge_deleted':
      return `${actor} ${tt('удалил соревнование группы')}`;
    case 'group_member_stats_inclusion_updated':
      return `${actor} ${tt('обновил участие участника в статистике группы')} ${target}`;
    default:
      return `${actor} · ${log.action}`;
  }
}

function exerciseLabel(
  filter: ExerciseFilter,
  localeExercise: { pushups: string; pullups: string; crunches: string; squats: string; plank: string },
) {
  if (filter === 'all') return null;
  if (filter === 'pushups') return localeExercise.pushups;
  if (filter === 'pullups') return localeExercise.pullups;
  if (filter === 'crunches') return localeExercise.crunches;
  if (filter === 'squats') return localeExercise.squats;
  return localeExercise.plank;
}

function getPeriodLabel(period: PeriodKey, progress: ReturnType<typeof useI18n>['messages']['progress']) {
  if (period === '7d') return progress.periods.d7;
  if (period === '90d') return progress.periods.d90;
  if (period === 'all') return progress.periods.all;
  return progress.periods.d30;
}

function formatAnalyticsValue(
  value: number | null,
  filter: ExerciseFilter,
  localeTag: string,
  loadUnit: string,
  kind?: 'count' | 'duration' | 'exercise' | 'load' | 'percent' | 'rate',
) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (kind === 'count') return Math.round(value).toLocaleString(localeTag);
  if (kind === 'percent') return `${Math.round(value).toLocaleString(localeTag)}%`;
  if (filter === 'all') return `${Math.round(value).toLocaleString(localeTag)} ${loadUnit}`;
  return formatExerciseValue(Math.round(value), filter, true);
}

function isWorkoutInPeriod(workout: Pick<GroupWorkout, 'date' | 'time'>, period: PeriodKey) {
  if (period === 'all') return true;
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const performedAt = new Date(workout.time || workout.date);
  return performedAt >= start && performedAt <= end;
}

function isExerciseFilterValue(value: string | null): value is ExerciseFilter {
  return value === 'all' || value === 'pushups' || value === 'pullups' || value === 'crunches' || value === 'squats' || value === 'plank';
}

function isPeriodKeyValue(value: string | null): value is PeriodKey {
  return value === '7d' || value === '30d' || value === '90d' || value === 'all';
}

function computeStats(workouts: GroupWorkout[]): WorkoutStats {
  const byDay = new Map<string, number>();
  workouts.forEach((workout) => {
    const key = normalizeDate(new Date(workout.time || workout.date));
    byDay.set(key, (byDay.get(key) ?? 0) + (workout.reps || 0));
  });

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayKey = normalizeDate(todayStart);
  const mondayOffset = (todayStart.getDay() + 6) % 7;
  const weekStart = new Date(todayStart);
  weekStart.setDate(todayStart.getDate() - mondayOffset);
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

  let totalWeek = 0;
  let totalMonth = 0;
  let totalAll = 0;

  for (const [dayKey, reps] of byDay.entries()) {
    totalAll += reps;
    const [y, m, d] = dayKey.split('-').map(Number);
    const dayDate = new Date(y, (m || 1) - 1, d || 1);
    if (dayDate >= weekStart && dayDate <= todayStart) totalWeek += reps;
    if (dayDate >= monthStart && dayDate <= todayStart) totalMonth += reps;
  }

  let streak = 0;
  if (byDay.size > 0) {
    const latest = Array.from(byDay.keys()).sort().reverse()[0];
    const [y, m, d] = latest.split('-').map(Number);
    const cursor = new Date(y, (m || 1) - 1, d || 1);
    while (byDay.has(normalizeDate(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  return {
    totalToday: byDay.get(todayKey) ?? 0,
    totalWeek,
    totalMonth,
    totalAll,
    streak,
  };
}

function computeStatsByExercise(workouts: GroupWorkout[]): WorkoutStatsByExercise {
  return {
    pushups: computeStats(workouts.filter((workout) => toExerciseType(workout.exerciseType) === 'pushups')),
    pullups: computeStats(workouts.filter((workout) => toExerciseType(workout.exerciseType) === 'pullups')),
    crunches: computeStats(workouts.filter((workout) => toExerciseType(workout.exerciseType) === 'crunches')),
    squats: computeStats(workouts.filter((workout) => toExerciseType(workout.exerciseType) === 'squats')),
    plank: computeStats(workouts.filter((workout) => toExerciseType(workout.exerciseType) === 'plank')),
  };
}

function ActivityHeatmap({
  cells,
  accent,
  filter,
  localeTag,
  loadUnit,
  labels,
}: {
  cells: HeatmapCell[];
  accent: string;
  filter: ExerciseFilter;
  localeTag: string;
  loadUnit: string;
  labels: {
    weekdays: string[];
    eachSquareDay: string;
    selectedDay: string;
    workload: string;
    less: string;
    more: string;
    noData: string;
  };
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const fallbackKey = useMemo(() => {
    for (let index = cells.length - 1; index >= 0; index -= 1) {
      if (cells[index].value > 0) return cells[index].key;
    }
    return cells[cells.length - 1]?.key ?? null;
  }, [cells]);

  if (!cells.length) return null;

  const weeks = new Map<number, HeatmapCell[]>();
  for (const cell of cells) {
    const bucket = weeks.get(cell.weekIndex) ?? [];
    bucket.push(cell);
    weeks.set(cell.weekIndex, bucket);
  }

  const columns = Array.from(weeks.values());
  const activeCell = cells.find((cell) => cell.key === selectedKey) ?? cells.find((cell) => cell.key === fallbackKey) ?? cells[cells.length - 1];

  return (
    <div style={heatmapWrap}>
      <div style={heatmapHint}>{labels.eachSquareDay}</div>
      <div style={heatmapScroller}>
        <div style={heatmapLayout}>
          <div style={heatmapWeekdayColumn}>
            {labels.weekdays.map((label) => (
              <div key={label} style={heatmapWeekdayLabel}>{label}</div>
            ))}
          </div>

          <div style={heatmapBody}>
            <div style={heatmapWeekNumbersRow}>
              {columns.map((column, index) => {
                const topCell = column[0] ?? null;
                return (
                  <div key={`week-${index}`} style={heatmapWeekNumber}>
                    {topCell ? getIsoWeekNumber(topCell.date) : ''}
                  </div>
                );
              })}
            </div>

            <div style={heatmapColumnsRow}>
              {columns.map((column, columnIndex) => (
                <div key={`column-${columnIndex}`} style={heatmapWeekColumn}>
                  {Array.from({ length: 7 }).map((_, weekday) => {
                    const cell = column.find((item) => item.weekday === weekday);
                    const isActive = cell?.key === activeCell.key;
                    return (
                      <button
                        key={`day-${weekday}`}
                        type="button"
                        onClick={() => {
                          if (cell) setSelectedKey(cell.key);
                        }}
                        title={cell ? `${cell.label}: ${formatAnalyticsValue(cell.value, filter, localeTag, loadUnit)}` : labels.noData}
                        style={{
                          ...heatmapCellButton,
                          border: isActive ? `1px solid ${accent}` : '1px solid rgba(148, 163, 184, 0.18)',
                          background: cell ? hexToRgba(accent, cell.intensity ? 0.14 + cell.intensity * 0.7 : 0.08) : '#f1f5f9',
                          boxShadow: isActive ? `0 0 0 2px ${hexToRgba(accent, 0.18)}` : 'none',
                          cursor: cell ? 'pointer' : 'default',
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={heatmapMetaGrid}>
        <div style={heatmapMetaBadge}>
          <div style={heatmapMetaLabel}>{labels.selectedDay}</div>
          <div style={heatmapMetaValue}>{activeCell.label}</div>
        </div>
        <div style={heatmapMetaBadge}>
          <div style={heatmapMetaLabel}>{labels.workload}</div>
          <div style={heatmapMetaValue}>{formatAnalyticsValue(activeCell.value, filter, localeTag, loadUnit)}</div>
        </div>
      </div>

      <div style={heatmapLegendRow}>
        <span>{labels.less}</span>
        {[0.12, 0.28, 0.46, 0.7, 0.94].map((alpha) => (
          <span key={alpha} style={{ ...heatmapLegendSwatch, background: hexToRgba(accent, alpha) }} />
        ))}
        <span>{labels.more}</span>
      </div>
    </div>
  );
}

type GroupView = 'overview' | 'members' | 'challenges' | 'manage';

export function GroupPageClient({ view = 'overview' }: { view?: GroupView }) {
  const { locale, messages } = useI18n();
  const localeTag = getIntlLocale(locale);
  const tt = (input: string) => t(locale, input);
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const groupId = String(params?.id || '');
  const searchExercise = searchParams.get('exercise');
  const searchPeriod = searchParams.get('period');
  const searchSpotlight = searchParams.get('spotlight') || '';
  const searchMemberQuery = searchParams.get('memberQuery') || '';

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [workoutsByUser, setWorkoutsByUser] = useState<Record<string, GroupWorkout[]>>({});
  const [challenges, setChallenges] = useState<GroupChallenge[]>([]);
  const [auditLogs, setAuditLogs] = useState<GroupAuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [ownershipUserId, setOwnershipUserId] = useState('');
  const [challengeName, setChallengeName] = useState('');
  const [challengeExercise, setChallengeExercise] = useState('pushups');
  const [challengeMode, setChallengeMode] = useState('most');
  const [challengeTarget, setChallengeTarget] = useState('100');
  const [challengeStartDate, setChallengeStartDate] = useState(todayDateString());
  const [challengeEndDate, setChallengeEndDate] = useState(plusDaysString(14));
  const [ownerExitOpen, setOwnerExitOpen] = useState(false);
  const [statsToggleUserId, setStatsToggleUserId] = useState('');
  const [groupExerciseFilter, setGroupExerciseFilter] = useState<ExerciseFilter>(
    isExerciseFilterValue(searchExercise) ? searchExercise : 'all',
  );
  const [groupPeriod, setGroupPeriod] = useState<PeriodKey>(
    isPeriodKeyValue(searchPeriod) ? searchPeriod : '30d',
  );
  const [feedPeriod, setFeedPeriod] = useState<PeriodKey>('30d');
  const [spotlightUserId, setSpotlightUserId] = useState('');
  const [memberQuery, setMemberQuery] = useState(searchMemberQuery);

  const deferredExerciseFilter = useDeferredValue(groupExerciseFilter);
  const deferredGroupPeriod = useDeferredValue(groupPeriod);
  const deferredFeedPeriod = useDeferredValue(feedPeriod);

  const manageableMembers = useMemo(
    () => (group?.members || []).filter((member) => !member.isOwner),
    [group?.members],
  );

  const normalizedMemberQuery = useMemo(() => memberQuery.trim().toLowerCase(), [memberQuery]);

  const filteredMembers = useMemo(() => {
    if (!normalizedMemberQuery) return group?.members || [];
    return (group?.members || []).filter((member) => {
      const haystack = [member.user.username, member.user.email || ''].join(' ').toLowerCase();
      return haystack.includes(normalizedMemberQuery);
    });
  }, [group?.members, normalizedMemberQuery]);

  const statsIncludedMembers = useMemo(
    () => (group?.members || []).filter((member) => member.includeInStats),
    [group?.members],
  );

  const filteredStatsMembers = useMemo(() => {
    if (!normalizedMemberQuery) return statsIncludedMembers;
    return statsIncludedMembers.filter((member) => {
      const haystack = [member.user.username, member.user.email || ''].join(' ').toLowerCase();
      return haystack.includes(normalizedMemberQuery);
    });
  }, [normalizedMemberQuery, statsIncludedMembers]);

  const memberStats = useMemo(() => {
    if (!group) return [];
    return statsIncludedMembers.map((member) => ({
      member,
      stats: computeStats(workoutsByUser[member.user.username] || []),
      statsByExercise: computeStatsByExercise(workoutsByUser[member.user.username] || []),
    }));
  }, [group, statsIncludedMembers, workoutsByUser]);

  const filteredMemberStats = useMemo(
    () => memberStats.filter(({ member }) => filteredStatsMembers.some((candidate) => candidate.userId === member.userId)),
    [filteredStatsMembers, memberStats],
  );

  const memberById = useMemo(
    () => new Map((group?.members || []).map((member) => [member.userId, member])),
    [group?.members],
  );

  const flatGroupWorkouts = useMemo<GroupFeedItem[]>(() => {
    if (!group) return [];
    const memberByUsername = new Map(
      group.members.map((member) => [
        member.user.username,
        {
          userId: member.userId,
          username: member.user.username,
          avatarPath: member.user.avatarPath ?? null,
        },
      ]),
    );

    return Object.entries(workoutsByUser)
      .flatMap(([username, workouts]) => {
        const owner = memberByUsername.get(username);
        return workouts.map((workout) => ({
          ...workout,
          ownerUserId: owner?.userId || username,
          ownerUsername: owner?.username || username,
          ownerAvatarPath: owner?.avatarPath ?? null,
          occurredAt: new Date(workout.time || workout.date).getTime(),
        }));
      })
      .sort((left, right) => right.occurredAt - left.occurredAt);
  }, [group, workoutsByUser]);

  const statsIncludedUserIds = useMemo(
    () => new Set(statsIncludedMembers.map((member) => member.userId)),
    [statsIncludedMembers],
  );

  const statsGroupWorkouts = useMemo(
    () => flatGroupWorkouts.filter((item) => statsIncludedUserIds.has(item.ownerUserId)),
    [flatGroupWorkouts, statsIncludedUserIds],
  );

  const groupAnalytics = useMemo(
    () =>
      buildProgressAnalytics({
        workouts: statsGroupWorkouts as WorkoutRecord[],
        exercise: deferredExerciseFilter,
        period: deferredGroupPeriod,
        copy: messages.progress,
      }),
    [deferredExerciseFilter, deferredGroupPeriod, messages.progress, statsGroupWorkouts],
  );

  const filteredFeedItems = useMemo(() => {
    return statsGroupWorkouts
      .filter((item) => deferredExerciseFilter === 'all' || item.exerciseType === deferredExerciseFilter)
      .filter((item) => isWorkoutInPeriod(item, deferredFeedPeriod));
  }, [deferredExerciseFilter, deferredFeedPeriod, statsGroupWorkouts]);

  const groupedFeedItems = useMemo(() => {
    const groups = new Map<string, GroupFeedItem[]>();
    filteredFeedItems.forEach((item) => {
      const dayKey = normalizeDate(getWorkoutDate(item));
      const bucket = groups.get(dayKey) ?? [];
      bucket.push(item);
      groups.set(dayKey, bucket);
    });

    return Array.from(groups.entries()).map(([dayKey, items]) => ({
      dayKey,
      items: items.sort((left, right) => right.occurredAt - left.occurredAt),
    }));
  }, [filteredFeedItems]);

  const leaderboard = useMemo(() => {
    if (!group) return [];
    const totals = new Map<string, { userId: string; username: string; total: number }>();

    statsIncludedMembers.forEach((member) => {
      totals.set(member.userId, {
        userId: member.userId,
        username: member.user.username,
        total: 0,
      });
    });

    statsGroupWorkouts.forEach((item) => {
      if (deferredExerciseFilter !== 'all' && item.exerciseType !== deferredExerciseFilter) return;
      if (!isWorkoutInPeriod(item, deferredGroupPeriod)) return;
      const row = totals.get(item.ownerUserId);
      if (!row) return;
      row.total += deferredExerciseFilter === 'all'
        ? toLoadPoints(item.reps, item.exerciseType as 'pushups' | 'pullups' | 'crunches' | 'squats' | 'plank')
        : item.reps;
    });

    return Array.from(totals.values())
      .filter((item) => item.total > 0)
      .sort((left, right) => right.total - left.total)
      .slice(0, 5);
  }, [deferredExerciseFilter, deferredGroupPeriod, group, statsGroupWorkouts, statsIncludedMembers]);

  const memberPageQuery = useMemo(() => {
    const query = new URLSearchParams();
    query.set('exercise', groupExerciseFilter);
    query.set('period', groupPeriod);
    if (memberQuery.trim()) query.set('memberQuery', memberQuery.trim());
    return query.toString();
  }, [groupExerciseFilter, groupPeriod, memberQuery]);

  const spotlightCandidates = useMemo(
    () => statsIncludedMembers.filter((member) => !member.isOwner || statsIncludedMembers.length === 1),
    [statsIncludedMembers],
  );

  const spotlightWorkouts = useMemo(
    () => statsGroupWorkouts.filter((item) => item.ownerUserId === spotlightUserId),
    [spotlightUserId, statsGroupWorkouts],
  );

  const spotlightAnalytics = useMemo(
    () =>
      buildProgressAnalytics({
        workouts: spotlightWorkouts as WorkoutRecord[],
        exercise: deferredExerciseFilter,
        period: deferredGroupPeriod,
        copy: messages.progress,
      }),
    [deferredExerciseFilter, deferredGroupPeriod, messages.progress, spotlightWorkouts],
  );

  const load = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    setError(null);
    try {
      const [groupRes, workoutsRes, challengesRes] = await Promise.all([
        fetchJsonSafe<{ group: GroupDetail }>(`/api/groups/${groupId}`),
        fetchJsonSafe<{ byUser: Record<string, GroupWorkout[]> }>(`/api/groups/${groupId}/workouts`),
        fetchJsonSafe<GroupChallenge[]>(`/api/groups/${groupId}/challenges`),
      ]);
      setGroup(groupRes.group);
      setNameDraft(groupRes.group.name);
      setWorkoutsByUser(workoutsRes.byUser || {});
      setChallenges(Array.isArray(challengesRes) ? challengesRes : []);

      if (groupRes.group.canManage) {
        const auditRes = await fetchJsonSafe<{ logs: GroupAuditLogItem[] }>(`/api/groups/${groupId}/audit`);
        setAuditLogs(Array.isArray(auditRes.logs) ? auditRes.logs : []);
      } else {
        setAuditLogs([]);
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (typeof window === 'undefined' || !group) return undefined;

    window.dispatchEvent(new CustomEvent('appPageHeaderAction', { detail: { label: t(locale, 'Покинуть') } }));

    const onHeaderActionClick = () => {
      if (group.isOwner) {
        setOwnerExitOpen(true);
        return;
      }

      void (async () => {
        if (!window.confirm(t(locale, 'Покинуть группу?'))) return;
        setError(null);
        setInfo(null);
        try {
          await fetchJsonSafe(`/api/groups/${groupId}/leave`, { method: 'POST' });
          window.location.href = '/groups';
        } catch (e) {
          setError(getErrorMessage(e));
        }
      })();
    };

    window.addEventListener('appPageHeaderActionClick', onHeaderActionClick);
    return () => {
      window.removeEventListener('appPageHeaderActionClick', onHeaderActionClick);
      window.dispatchEvent(new CustomEvent('appPageHeaderAction', { detail: { label: null } }));
    };
  }, [group, groupId, locale]);

  useEffect(() => {
    if (!spotlightCandidates.length) {
      setSpotlightUserId('');
      return;
    }
    if (!spotlightUserId && searchSpotlight && spotlightCandidates.some((member) => member.userId === searchSpotlight)) {
      setSpotlightUserId(searchSpotlight);
      return;
    }
    if (!spotlightUserId || !spotlightCandidates.some((member) => member.userId === spotlightUserId)) {
      setSpotlightUserId(spotlightCandidates[0]?.userId || '');
    }
  }, [searchSpotlight, spotlightCandidates, spotlightUserId]);

  async function renameGroup(event: FormEvent) {
    event.preventDefault();
    setRenaming(true);
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe(`/api/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameDraft }),
      });
      setInfo(tt('Название группы обновлено'));
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setRenaming(false);
    }
  }

  async function handleRequest(requestId: string, action: 'approve' | 'reject') {
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe(`/api/groups/${groupId}/requests/${requestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      setInfo(action === 'approve' ? tt('Заявка подтверждена') : tt('Заявка отклонена'));
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function removeMember(userId: string) {
    if (!window.confirm(tt('Исключить участника из группы?'))) return;
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe(`/api/groups/${groupId}/members/${userId}`, { method: 'DELETE' });
      setInfo(tt('Участник исключён'));
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function toggleMemberStatsInclusion(member: MemberItem, includeInStats: boolean) {
    setStatsToggleUserId(member.userId);
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe(`/api/groups/${groupId}/members/${member.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeInStats }),
      });
      setInfo(includeInStats ? tt('Участник включён в статистику группы') : tt('Участник исключён из статистики группы'));
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setStatsToggleUserId('');
    }
  }

  async function transferOwnership() {
    if (!ownershipUserId) return;
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe(`/api/groups/${groupId}/ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextOwnerId: ownershipUserId }),
      });
      setInfo(tt('Права владельца переданы'));
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function deleteGroup() {
    if (!window.confirm(tt('Удалить группу целиком?'))) return;
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe(`/api/groups/${groupId}`, { method: 'DELETE' });
      window.location.href = '/groups';
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function rotateInviteLink() {
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe(`/api/groups/${groupId}/invite`, { method: 'POST' });
      setInfo(tt('Ссылка приглашения обновлена'));
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function copyInviteLink() {
    if (!group?.inviteToken) return;
    const link = `${window.location.origin}/groups?invite=${group.inviteToken}`;
    await navigator.clipboard.writeText(link);
    setInfo(tt('Ссылка приглашения скопирована'));
  }

  async function confirmOwnerTransferAndLeave() {
    if (!ownershipUserId) {
      setError(tt('Сначала выберите нового владельца'));
      return;
    }
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe(`/api/groups/${groupId}/ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextOwnerId: ownershipUserId }),
      });
      await fetchJsonSafe(`/api/groups/${groupId}/leave`, { method: 'POST' });
      window.location.href = '/groups';
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function createChallenge(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe(`/api/groups/${groupId}/challenges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: challengeName,
          exerciseType: challengeExercise,
          mode: challengeMode,
          targetReps: challengeMode === 'most' ? undefined : Number(challengeTarget),
          startDate: challengeStartDate,
          endDate: challengeEndDate,
        }),
      });
      setInfo(tt('Соревнование создано'));
      setChallengeName('');
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  const isOverview = view === 'overview';
  const isMembersView = view === 'members';
  const isChallengesView = view === 'challenges';
  const isManageView = view === 'manage';
  if (loading) {
    return <div className="app-page" style={page}><p style={loadingBanner}>{tt('Загрузка…')}</p></div>;
  }

  if (!group) {
    return <div className="app-page" style={page}><p style={errorBanner}>{error || tt('Группа не найдена')}</p></div>;
  }

  return (
    <div className="app-page" style={page}>
      {error ? <p style={errorBanner}>{error}</p> : null}
      {info ? <p style={infoBanner}>{info}</p> : null}
      {isManageView && !group.canManage ? <p style={errorBanner}>{tt('Недостаточно прав для управления группой.')}</p> : null}

      {group.canManage && isOverview ? (
      <section style={card}>
        <div style={{ display: 'grid', gap: 6 }}>
          <h2 style={sectionTitle}>{tt('Сводка группы')}</h2>
        </div>

        <div style={filterGroup}>
          <div style={filterRow}>
            {(['all', 'pushups', 'pullups', 'crunches', 'squats', 'plank'] as ExerciseFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => startTransition(() => setGroupExerciseFilter(filter))}
                style={{
                  ...filterPill,
                  borderColor: filter === groupExerciseFilter ? getExerciseAccent(filter) : 'rgba(148, 163, 184, 0.32)',
                  background: filter === groupExerciseFilter ? 'rgba(255,255,255,0.98)' : 'rgba(248, 250, 252, 0.88)',
                }}
                aria-label={filter === 'all' ? messages.progress.exercises.all : (exerciseLabel(filter, messages.nav.exercise) || filter)}
              >
                {filter === 'all' ? (
                  messages.progress.exercises.all
                ) : (
                  <Image
                    src={exerciseFeedIcon(filter)}
                    alt={exerciseLabel(filter, messages.nav.exercise) || filter}
                    width={18}
                    height={18}
                    style={filterExerciseIcon}
                    unoptimized
                  />
                )}
              </button>
            ))}
          </div>

          <div style={filterRow}>
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => startTransition(() => setGroupPeriod(option.key))}
                style={{
                  ...filterPill,
                  borderColor: option.key === groupPeriod ? '#0f766e' : 'rgba(148, 163, 184, 0.32)',
                  background: option.key === groupPeriod ? 'rgba(240, 253, 250, 0.96)' : 'rgba(248, 250, 252, 0.88)',
                }}
              >
                {getPeriodLabel(option.key, messages.progress)}
              </button>
            ))}
          </div>
        </div>

        {!groupAnalytics.hasDataInRange ? (
          <div style={emptyCard}>{messages.progress.states.noDataPeriodBody}</div>
        ) : (
          <>
            <div style={analyticsGrid}>
              {groupAnalytics.kpis.slice(0, 5).map((cardItem) => (
                <div key={cardItem.id} style={analyticsCard}>
                  <span style={statLabel}>{cardItem.label}</span>
                  <strong style={analyticsValue}>
                    {formatAnalyticsValue(cardItem.metric.value, deferredExerciseFilter, localeTag, messages.progress.header.loadUnit, cardItem.metric.kind)}
                  </strong>
                  {cardItem.note ? <span style={metaLine}>{cardItem.note}</span> : null}
                </div>
              ))}
            </div>

            <div style={grid}>
              <div style={subCard}>
                <h3 style={subTitle}>{messages.progress.sections.volumeByDay}</h3>
                <div style={trendBars}>
                  {groupAnalytics.volumeSeries.slice(-14).map((point) => {
                    const maxValue = Math.max(1, ...groupAnalytics.volumeSeries.map((seriesPoint) => seriesPoint.value));
                    const height = point.value > 0 ? Math.max(14, Math.round((point.value / maxValue) * 120)) : 8;
                    return (
                      <div key={point.key} style={trendColumn}>
                        <div
                          style={{
                            ...trendBar,
                            height,
                            background: getExerciseAccent(deferredExerciseFilter),
                            opacity: point.value > 0 ? 0.92 : 0.24,
                          }}
                          title={`${point.label}: ${formatAnalyticsValue(point.value, deferredExerciseFilter, localeTag, messages.progress.header.loadUnit)}`}
                        />
                        <span style={trendLabel}>{point.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={subCard}>
                <h3 style={subTitle}>{tt('Лидеры периода')}</h3>
                {leaderboard.length === 0 ? <div style={emptyCard}>{messages.progress.states.noDataPeriodBody}</div> : null}
                <div style={stackCompact}>
                  {leaderboard.map((item, index) => (
                    <button
                      key={item.userId}
                      type="button"
                      onClick={() => setSpotlightUserId(item.userId)}
                      style={{
                        ...leaderRow,
                        borderColor: spotlightUserId === item.userId ? 'rgba(15, 118, 110, 0.28)' : 'rgba(226, 232, 240, 0.75)',
                        background: spotlightUserId === item.userId ? 'rgba(240, 253, 250, 0.92)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <strong>{index + 1}. {item.username}</strong>
                      <span style={metaLine}>
                        {formatAnalyticsValue(item.total, deferredExerciseFilter, localeTag, messages.progress.header.loadUnit)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={grid}>
              <div style={subCard}>
                <h3 style={subTitle}>{messages.progress.sections.activityCalendar}</h3>
                <ActivityHeatmap
                  cells={groupAnalytics.heatmap}
                  accent={getExerciseAccent(deferredExerciseFilter)}
                  filter={deferredExerciseFilter}
                  localeTag={localeTag}
                  loadUnit={messages.progress.header.loadUnit}
                  labels={{
                    weekdays: [
                      messages.progress.weekdays.mon,
                      messages.progress.weekdays.tue,
                      messages.progress.weekdays.wed,
                      messages.progress.weekdays.thu,
                      messages.progress.weekdays.fri,
                      messages.progress.weekdays.sat,
                      messages.progress.weekdays.sun,
                    ],
                    eachSquareDay: messages.progress.chart.eachSquareDay,
                    selectedDay: messages.progress.chart.selectedDay,
                    workload: messages.progress.chart.workload,
                    less: messages.progress.chart.less,
                    more: messages.progress.chart.more,
                    noData: tt('Нет данных'),
                  }}
                />
              </div>

              <div style={subCard}>
                <h3 style={subTitle}>{messages.progress.sections.loadDistribution}</h3>
                {groupAnalytics.distribution.length === 0 ? <div style={emptyCard}>{messages.progress.states.distributionEmptyBody}</div> : null}
                <div style={stackCompact}>
                  {groupAnalytics.distribution.map((item) => (
                    <div key={item.exercise} style={distributionRow}>
                      <div style={{ display: 'grid', gap: 4, minWidth: 0, flex: 1 }}>
                        <div style={distributionTitleRow}>
                          <Image
                            src={exerciseFeedIcon(item.exercise)}
                            alt={exerciseLabel(item.exercise, messages.nav.exercise) || item.exercise}
                            width={18}
                            height={18}
                            style={distributionIcon}
                            unoptimized
                          />
                        </div>
                        <div style={distributionTrack}>
                          <div
                            style={{
                              ...distributionFill,
                              width: `${Math.max(6, Math.round(item.share * 100))}%`,
                              background: getExerciseAccent(item.exercise),
                            }}
                          />
                        </div>
                      </div>
                      <span style={metaLine}>{Math.round(item.share * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </section>
      ) : null}

      {isOverview ? (
      <section style={card}>
        <h2 style={sectionTitle}>{tt('Статистика участников')}</h2>
        {filteredMemberStats.length === 0 ? <div style={emptyCard}>{tt('Нет участников по текущему фильтру.')}</div> : null}
        {filteredMemberStats.length > 0 ? (
          <div className="table-scroll">
            <table style={memberTable}>
              <thead>
                <tr style={memberTableHeadRow}>
                  <th style={{ ...memberTh, ...memberStickyNameHead }}>{tt('Имя')}</th>
                  <th style={{ ...memberTh, ...memberStickyExerciseHead }}>{tt('Упр')}</th>
                  <th style={memberTh}>{tt('Сегодня')}</th>
                  <th style={memberTh}>{tt('Всего')}</th>
                  <th style={memberTh}>{tt('Месяц')}</th>
                  <th style={memberTh}>{tt('Неделя')}</th>
                  <th style={memberTh}>{tt('Серия')}</th>
                  <th style={memberTh}>{tt('Действия')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredMemberStats.map(({ member, statsByExercise }) => (
                  <tr key={member.userId}>
                    <td style={{ ...memberTd, ...memberStickyNameCell }} className="table-sticky-first">
                      <div style={memberNameCell}>
                        <strong style={memberNameText}>{member.user.username}</strong>
                        {member.isOwner ? <span style={memberRolePill}>{tt('Владелец')}</span> : null}
                      </div>
                    </td>
                    <td style={{ ...memberTd, ...memberStickyExerciseCell }}>
                      <div style={exerciseIconStack}>
                        {EXERCISE_ORDER.map((type) => (
                          <Image
                            key={`${member.userId}-${type}`}
                            src={exerciseFeedIcon(type)}
                            alt={exerciseLabel(type, messages.nav.exercise) || type}
                            width={16}
                            height={16}
                            style={tableExerciseIcon}
                            unoptimized
                          />
                        ))}
                      </div>
                    </td>
                    <td style={memberTdNum}>
                      <div style={metricStack}>
                        {EXERCISE_ORDER.map((type) => <span key={`${member.userId}-today-${type}`} style={metricValue}>{statsByExercise[type].totalToday}</span>)}
                      </div>
                    </td>
                    <td style={memberTdNum}>
                      <div style={metricStack}>
                        {EXERCISE_ORDER.map((type) => <span key={`${member.userId}-all-${type}`} style={metricValue}>{statsByExercise[type].totalAll}</span>)}
                      </div>
                    </td>
                    <td style={memberTdNum}>
                      <div style={metricStack}>
                        {EXERCISE_ORDER.map((type) => <span key={`${member.userId}-month-${type}`} style={metricValue}>{statsByExercise[type].totalMonth}</span>)}
                      </div>
                    </td>
                    <td style={memberTdNum}>
                      <div style={metricStack}>
                        {EXERCISE_ORDER.map((type) => <span key={`${member.userId}-week-${type}`} style={metricValue}>{statsByExercise[type].totalWeek}</span>)}
                      </div>
                    </td>
                    <td style={memberTdNum}>
                      <div style={metricStack}>
                        {EXERCISE_ORDER.map((type) => <span key={`${member.userId}-streak-${type}`} style={metricValue}>{statsByExercise[type].streak}</span>)}
                      </div>
                    </td>
                    <td style={memberTd}>
                      <div style={memberActionsCell}>
                        <Link href={`/groups/${groupId}/members/${member.userId}?${memberPageQuery}`} style={btnSecondary}>
                          {tt('Открыть')}
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      ) : null}

      {group.canManage && isOverview ? (
      <section style={card}>
        <h2 style={sectionTitle}>{tt('Фокус на участнике')}</h2>
        <input
          value={memberQuery}
          onChange={(event) => setMemberQuery(event.target.value)}
          placeholder={tt('Найти участника')}
          style={input}
        />
        <div style={filterRow}>
          {spotlightCandidates
            .filter((member) => filteredMembers.some((candidate) => candidate.userId === member.userId))
            .map((member) => (
            <button
              key={member.userId}
              type="button"
              onClick={() => setSpotlightUserId(member.userId)}
              style={{
                ...memberChip,
                borderColor: spotlightUserId === member.userId ? '#0f766e' : 'rgba(148, 163, 184, 0.32)',
                background: spotlightUserId === member.userId ? 'rgba(240, 253, 250, 0.96)' : 'rgba(255,255,255,0.96)',
              }}
            >
              {member.user.username}
            </button>
          ))}
        </div>

        {!spotlightUserId || !memberById.get(spotlightUserId) ? (
          <div style={emptyCard}>{tt('Нет данных по выбранному участнику.')}</div>
        ) : (
          <div id="group-member-spotlight" style={stack}>
            <div style={analyticsGrid}>
              {spotlightAnalytics.kpis.slice(0, 5).map((cardItem) => (
                <div key={cardItem.id} style={analyticsCard}>
                  <span style={statLabel}>{cardItem.label}</span>
                  <strong style={analyticsValue}>
                    {formatAnalyticsValue(cardItem.metric.value, deferredExerciseFilter, localeTag, messages.progress.header.loadUnit, cardItem.metric.kind)}
                  </strong>
                  {cardItem.note ? <span style={metaLine}>{cardItem.note}</span> : null}
                </div>
              ))}
            </div>

            <div style={grid}>
              <div style={subCard}>
                <h3 style={subTitle}>{messages.progress.sections.activityCalendar}</h3>
                <ActivityHeatmap
                  cells={spotlightAnalytics.heatmap}
                  accent={getExerciseAccent(deferredExerciseFilter)}
                  filter={deferredExerciseFilter}
                  localeTag={localeTag}
                  loadUnit={messages.progress.header.loadUnit}
                  labels={{
                    weekdays: [
                      messages.progress.weekdays.mon,
                      messages.progress.weekdays.tue,
                      messages.progress.weekdays.wed,
                      messages.progress.weekdays.thu,
                      messages.progress.weekdays.fri,
                      messages.progress.weekdays.sat,
                      messages.progress.weekdays.sun,
                    ],
                    eachSquareDay: messages.progress.chart.eachSquareDay,
                    selectedDay: messages.progress.chart.selectedDay,
                    workload: messages.progress.chart.workload,
                    less: messages.progress.chart.less,
                    more: messages.progress.chart.more,
                    noData: tt('Нет данных'),
                  }}
                />
              </div>

              <div style={subCard}>
                <h3 style={subTitle}>{tt('Последние тренировки участника')}</h3>
                <div style={stackCompact}>
                  {spotlightWorkouts
                    .filter((item) => deferredExerciseFilter === 'all' || item.exerciseType === deferredExerciseFilter)
                    .slice(0, 8)
                    .map((item) => (
                      <div key={item.id} style={leaderRow}>
                        <strong>{exerciseLabel(item.exerciseType as ExerciseFilter, messages.nav.exercise) || item.exerciseType}</strong>
                        <span style={metaLine}>
                          {formatExerciseValue(item.reps, item.exerciseType, true)} · {new Date(item.time || item.date).toLocaleDateString(localeTag)}
                        </span>
                      </div>
                    ))}
                  {spotlightWorkouts.length === 0 ? <div style={emptyCard}>{tt('Нет данных по выбранному участнику.')}</div> : null}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
      ) : null}

      {isManageView ? (
      <section style={grid}>
        {group.canManage ? (
          <form onSubmit={renameGroup} style={card}>
            <h2 style={sectionTitle}>{tt('Название группы')}</h2>
            <input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} style={input} />
            <button type="submit" style={btnPrimary} disabled={renaming || !nameDraft.trim()}>
              {renaming ? tt('Сохранение…') : tt('Сохранить')}
            </button>
          </form>
        ) : null}

        {group.canManage ? (
          <div style={card}>
            <h2 style={sectionTitle}>{tt('Ссылка приглашения')}</h2>
            {group.inviteUpdatedAt ? (
              <p style={metaLine}>
                {tt('Ссылка приглашения обновлена')}: {new Date(group.inviteUpdatedAt).toLocaleString(locale)}
              </p>
            ) : null}
            <div style={actionRow}>
              {group.inviteToken ? <button type="button" onClick={() => void copyInviteLink()} style={btnSecondary}>{tt('Скопировать ссылку')}</button> : null}
              <button type="button" onClick={() => void rotateInviteLink()} style={btnSecondary}>{tt('Обновить ссылку')}</button>
            </div>
          </div>
        ) : null}

      {group.isOwner ? (
          <div style={card}>
            <h2 style={sectionTitle}>{tt('Передача владения')}</h2>
            <select value={ownershipUserId} onChange={(event) => setOwnershipUserId(event.target.value)} style={input}>
              <option value="">{tt('Выберите участника')}</option>
              {manageableMembers.map((member) => (
                <option key={member.userId} value={member.userId}>{member.user.username}</option>
              ))}
            </select>
            <button type="button" style={btnSecondary} disabled={!ownershipUserId} onClick={() => void transferOwnership()}>
              {tt('Передать права')}
            </button>
            <button type="button" style={btnDanger} onClick={() => void deleteGroup()}>
              {tt('Удалить группу')}
            </button>
          </div>
        ) : null}
      </section>
      ) : null}

      {isMembersView ? (
      <section style={card}>
        <h2 style={sectionTitle}>{tt('Участники')}</h2>
        {filteredMembers.length === 0 ? <div style={emptyCard}>{tt('Нет участников по текущему фильтру.')}</div> : null}
        {filteredMembers.length > 0 ? (
          <div className="table-scroll">
            <table style={memberTable}>
              <thead>
                <tr style={memberTableHeadRow}>
                  <th style={{ ...memberTh, ...memberStickyNameHead }}>{tt('Имя')}</th>
                  {group.canManage ? <th style={memberTh}>{tt('В статистике')}</th> : null}
                  <th style={memberTh}>{tt('Дата')}</th>
                  <th style={memberTh}>{tt('Действия')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((member) => (
                  <tr key={member.userId}>
                    <td style={{ ...memberTd, ...memberStickyNameCell }} className="table-sticky-first">
                      <div style={memberNameCell}>
                        <strong style={memberNameText}>{member.user.username}</strong>
                        {member.isOwner ? <span style={memberRolePill}>{tt('Владелец')}</span> : null}
                      </div>
                    </td>
                    {group.canManage ? (
                      <td style={memberTd}>
                        <label style={statsCheckboxLabel}>
                          <input
                            type="checkbox"
                            checked={member.includeInStats}
                            disabled={statsToggleUserId === member.userId}
                            onChange={(event) => {
                              void toggleMemberStatsInclusion(member, event.target.checked);
                            }}
                          />
                          <span>{member.includeInStats ? tt('Да') : tt('Нет')}</span>
                        </label>
                      </td>
                    ) : null}
                    <td style={memberTd}>
                      {new Date(member.joinedAt).toLocaleDateString(localeTag)}
                    </td>
                    <td style={memberTd}>
                      <div style={memberActionsCell}>
                        <Link href={`/groups/${groupId}/members/${member.userId}?${memberPageQuery}`} style={btnSecondary}>
                          {tt('Открыть')}
                        </Link>
                        {group.canManage && !member.isOwner ? (
                          <button type="button" style={btnDanger} onClick={() => void removeMember(member.userId)}>
                            {tt('Исключить')}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      ) : null}

      {group.canManage && isManageView ? (
        <section style={card}>
          <h2 style={sectionTitle}>{tt('Заявки на вступление')}</h2>
          {group.pendingRequests.length === 0 ? <div style={emptyCard}>{tt('Новых заявок нет.')}</div> : null}
          <div style={stack}>
            {group.pendingRequests.map((request) => (
              <div key={request.id} style={rowCard}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong>{request.user.username}</strong>
                  <span style={metaLine}>{new Date(request.createdAt).toLocaleString(locale)}</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" style={btnPrimary} onClick={() => void handleRequest(request.id, 'approve')}>
                    {tt('Принять')}
                  </button>
                  <button type="button" style={btnSecondary} onClick={() => void handleRequest(request.id, 'reject')}>
                    {tt('Отклонить')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {isOverview ? (
      <section style={card}>
        <div style={feedHeaderRow}>
          <h2 style={{ ...sectionTitle, marginBottom: 0 }}>{tt('Лента тренировок')}</h2>
          <div role="group" aria-label={tt('Период')} style={feedLimitToggleRow}>
            {FEED_PERIOD_OPTIONS.map((period) => {
              const active = feedPeriod === period;
              const label = period === 'all' ? tt('Все') : tt(period === '7d' ? '7д' : period === '30d' ? '30д' : '90д');
              return (
                <button
                  key={`feed-period-${period}`}
                  type="button"
                  onClick={() => setFeedPeriod(period)}
                  style={{
                    ...feedLimitToggleBtn,
                    ...(active ? feedLimitToggleBtnActive : {}),
                  }}
                  aria-pressed={active}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {filteredFeedItems.length === 0 ? <div style={emptyCard}>{tt('Пока нет тренировок в группе.')}</div> : null}
        {filteredFeedItems.length > 0 ? (
          <div style={{ ...feedListWrap, ...feedListWrapScrollable }}>
            {groupedFeedItems.map((feedGroup) => (
              <section key={`feed-${feedGroup.dayKey}`} style={feedDaySection}>
                <div style={feedDayTitle}>{formatDateWithWeekday(feedGroup.dayKey, localeTag)}</div>
                {feedGroup.items.map((workout) => {
                  const type = toExerciseType(workout.exerciseType);
                  const typeColor = getExerciseAccent(type);
                  return (
                    <article
                      key={workout.id}
                      style={{
                        ...feedRowCard,
                        border: `1px solid ${hexToRgba(typeColor, 0.42)}`,
                        background: `linear-gradient(145deg, ${hexToRgba(typeColor, 0.18)} 0%, #ffffff 75%)`,
                      }}
                    >
                      <div style={feedRowGrid}>
                        <div style={feedUserCell}>
                          <div style={feedUserText}>
                            <span style={feedUserName}>{workout.ownerUsername}</span>
                            <span style={feedUserTime}> · {formatTimeHHMM(workout.time || workout.date)}</span>
                          </div>
                        </div>
                        <Image src={exerciseFeedIcon(type)} alt={exerciseLabel(type, messages.nav.exercise) || type} width={18} height={18} style={feedTypeIcon} unoptimized />
                        <div style={feedReps}>{formatExerciseValue(workout.reps, type, true)}</div>
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}
          </div>
        ) : null}
      </section>
      ) : null}

      {isChallengesView ? (
      <section style={card}>
        <h2 style={sectionTitle}>{tt('Соревнования группы')}</h2>
        {group.canManage ? (
          <form onSubmit={createChallenge} style={stack}>
            <div style={fieldGroup}>
              <span style={fieldLabel}>{tt('Участники соревнования')}</span>
              <span style={fieldHint}>{tt('Соревнование автоматически запускается для всех текущих участников группы.')}</span>
            </div>
            <input value={challengeName} onChange={(event) => setChallengeName(event.target.value)} placeholder={tt('Название')} style={input} />
            <div style={gridCompact}>
              <select value={challengeExercise} onChange={(event) => setChallengeExercise(event.target.value)} style={input}>
                <option value="pushups">pushups</option>
                <option value="pullups">pullups</option>
                <option value="crunches">crunches</option>
                <option value="squats">squats</option>
                <option value="plank">plank</option>
              </select>
              <select value={challengeMode} onChange={(event) => setChallengeMode(event.target.value)} style={input}>
                <option value="most">most</option>
                <option value="target">target</option>
                <option value="daily_min">daily_min</option>
                <option value="sets_min">sets_min</option>
              </select>
            </div>
            {challengeMode !== 'most' ? (
              <input value={challengeTarget} onChange={(event) => setChallengeTarget(event.target.value)} placeholder={tt('Цель')} style={input} />
            ) : null}
            <div style={gridCompact}>
              <input type="date" value={challengeStartDate} onChange={(event) => setChallengeStartDate(event.target.value)} style={input} />
              <input type="date" value={challengeEndDate} onChange={(event) => setChallengeEndDate(event.target.value)} style={input} />
            </div>
            <button type="submit" style={btnPrimary} disabled={!challengeName.trim()}>{tt('Создать соревнование')}</button>
          </form>
        ) : null}

        <div style={stack}>
          {challenges.length === 0 ? <div style={emptyCard}>{tt('Пока соревнований нет.')}</div> : null}
          {challenges.map((challenge) => (
            <div key={challenge.id} style={subCard}>
              <h3 style={subTitle}>{challenge.name}</h3>
              <div style={metaLine}>
                {challenge.exerciseType} · {challenge.mode} · {new Date(challenge.startDate).toLocaleDateString(locale)} - {new Date(challenge.endDate).toLocaleDateString(locale)}
              </div>
              <div style={metaLine}>
                {tt('Участники')}: {challenge.participants.map((participant) => participant.user.username).join(', ')}
              </div>
            </div>
          ))}
        </div>
      </section>
      ) : null}

      {group.canManage && isManageView ? (
        <section style={card}>
          <h2 style={sectionTitle}>{tt('Аудит группы')}</h2>
          {auditLogs.length === 0 ? <div style={emptyCard}>{tt('Записей аудита пока нет.')}</div> : null}
          <div style={stack}>
            {auditLogs.map((log) => (
              <div key={log.id} style={rowCard}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong>{describeAuditAction(tt, log)}</strong>
                  <span style={metaLine}>{new Date(log.createdAt).toLocaleString(locale)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {ownerExitOpen ? (
        <div style={modalBackdrop} role="dialog" aria-modal="true">
          <div style={modalCard}>
            <h2 style={sectionTitle}>{tt('Выход владельца из группы')}</h2>
            <p style={{ ...metaLine, margin: 0, lineHeight: 1.6 }}>
              {tt('Перед выходом нужно либо передать права другому участнику, либо удалить группу целиком.')}
            </p>
            <select value={ownershipUserId} onChange={(event) => setOwnershipUserId(event.target.value)} style={input}>
              <option value="">{tt('Выберите участника')}</option>
              {manageableMembers.map((member) => (
                <option key={member.userId} value={member.userId}>{member.user.username}</option>
              ))}
            </select>
            <div style={modalActions}>
              <button type="button" style={btnPrimary} disabled={!ownershipUserId} onClick={() => void confirmOwnerTransferAndLeave()}>
                {tt('Передать права и выйти')}
              </button>
              <button type="button" style={btnDanger} onClick={() => void deleteGroup()}>
                {tt('Удалить группу')}
              </button>
              <button type="button" style={btnSecondary} onClick={() => setOwnerExitOpen(false)}>
                {tt('Отмена')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function GroupDetailPage() {
  return <GroupPageClient view="overview" />;
}

const page: CSSProperties = {
  display: 'grid',
  gap: 18,
  maxWidth: 1080,
};

const grid: CSSProperties = {
  display: 'grid',
  gap: 16,
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
};

const gridCompact: CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
};

const filterGroup: CSSProperties = {
  display: 'grid',
  gap: 10,
};

const filterRow: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
};

const filterPill: CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.32)',
  borderRadius: 999,
  minWidth: 46,
  minHeight: 42,
  padding: '10px 14px',
  fontWeight: 800,
  color: '#0f172a',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const filterExerciseIcon: CSSProperties = {
  width: 18,
  height: 18,
  objectFit: 'contain',
  display: 'block',
};

const card: CSSProperties = {
  display: 'grid',
  gap: 14,
  padding: 18,
  borderRadius: 24,
  border: '1px solid rgba(226, 232, 240, 0.95)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 250, 252, 0.88) 100%)',
  boxShadow: '0 18px 42px rgba(15, 23, 42, 0.08)',
};

const subCard: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 14,
  borderRadius: 18,
  border: '1px solid rgba(226, 232, 240, 0.9)',
  background: 'rgba(255,255,255,0.9)',
};

const sectionTitle: CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 900,
  color: '#0f172a',
};

const subTitle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 800,
  color: '#0f172a',
};

const input: CSSProperties = {
  width: '100%',
  borderRadius: 14,
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  fontSize: 15,
  background: '#fff',
};

const fieldGroup: CSSProperties = {
  display: 'grid',
  gap: 6,
  alignContent: 'start',
};

const fieldLabel: CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: '#0f172a',
};

const fieldHint: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.4,
  color: '#64748b',
};

const btnPrimary: CSSProperties = {
  border: 'none',
  borderRadius: 14,
  padding: '12px 16px',
  background: '#0f766e',
  color: '#fff',
  fontWeight: 800,
  cursor: 'pointer',
};

const btnSecondary: CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.38)',
  borderRadius: 14,
  padding: '12px 16px',
  background: '#fff',
  color: '#0f172a',
  fontWeight: 700,
  cursor: 'pointer',
};

const btnDanger: CSSProperties = {
  border: '1px solid rgba(248, 113, 113, 0.4)',
  borderRadius: 14,
  padding: '12px 16px',
  background: 'rgba(254, 242, 242, 0.94)',
  color: '#b91c1c',
  fontWeight: 700,
  cursor: 'pointer',
};

const errorBanner: CSSProperties = {
  margin: 0,
  padding: '14px 16px',
  borderRadius: 18,
  color: '#991b1b',
  background: 'rgba(254, 226, 226, 0.92)',
  border: '1px solid rgba(248, 113, 113, 0.28)',
};

const infoBanner: CSSProperties = {
  margin: 0,
  padding: '14px 16px',
  borderRadius: 18,
  color: '#065f46',
  background: 'rgba(209, 250, 229, 0.92)',
  border: '1px solid rgba(16, 185, 129, 0.22)',
};

const loadingBanner: CSSProperties = {
  margin: 0,
  color: '#475569',
};

const stack: CSSProperties = {
  display: 'grid',
  gap: 12,
};

const stackCompact: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const actionRow: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
};

const rowCard: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  padding: 14,
  borderRadius: 18,
  border: '1px solid rgba(226, 232, 240, 0.9)',
  background: 'rgba(255,255,255,0.9)',
};

const analyticsGrid: CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
};

const analyticsCard: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 14,
  borderRadius: 18,
  border: '1px solid rgba(226, 232, 240, 0.9)',
  background: 'rgba(255,255,255,0.94)',
};

const analyticsValue: CSSProperties = {
  fontSize: 26,
  lineHeight: 1.05,
  color: '#0f172a',
};

const statLabel: CSSProperties = {
  fontSize: 12,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const metaLine: CSSProperties = {
  color: '#64748b',
  fontSize: 14,
};

const emptyCard: CSSProperties = {
  padding: 14,
  borderRadius: 18,
  border: '1px dashed rgba(148, 163, 184, 0.45)',
  color: '#64748b',
};

const trendBars: CSSProperties = {
  display: 'grid',
  gap: 10,
  gridTemplateColumns: 'repeat(auto-fit, minmax(28px, 1fr))',
  alignItems: 'end',
  minHeight: 170,
};

const trendColumn: CSSProperties = {
  display: 'grid',
  gap: 8,
  alignItems: 'end',
  justifyItems: 'center',
};

const trendBar: CSSProperties = {
  width: '100%',
  minHeight: 8,
  borderRadius: 999,
};

const trendLabel: CSSProperties = {
  fontSize: 11,
  color: '#64748b',
};

const leaderRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  padding: '10px 12px',
  border: '1px solid rgba(226, 232, 240, 0.75)',
  borderRadius: 14,
  background: 'rgba(255,255,255,0.88)',
  color: '#0f172a',
  textAlign: 'left',
};

const distributionRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const distributionTitleRow: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 18,
};

const distributionIcon: CSSProperties = {
  width: 18,
  height: 18,
  objectFit: 'contain',
  display: 'block',
};

const distributionTrack: CSSProperties = {
  width: '100%',
  height: 10,
  borderRadius: 999,
  background: 'rgba(226, 232, 240, 0.75)',
  overflow: 'hidden',
};

const distributionFill: CSSProperties = {
  height: '100%',
  borderRadius: 999,
};

const memberChip: CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.32)',
  borderRadius: 999,
  padding: '10px 14px',
  fontWeight: 800,
  color: '#0f172a',
  cursor: 'pointer',
};

const memberTable: CSSProperties = {
  width: 'max-content',
  minWidth: '100%',
  borderCollapse: 'collapse',
};

const memberTableHeadRow: CSSProperties = {
  background: '#f3f4f6',
};

const memberTh: CSSProperties = {
  padding: '6px 5px',
  borderBottom: '1px solid #dbe4ee',
  color: '#0f172a',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 900,
  whiteSpace: 'nowrap',
};

const memberTd: CSSProperties = {
  padding: '6px 5px',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'top',
  color: '#0f172a',
  background: '#fff',
};

const memberTdNum: CSSProperties = {
  ...memberTd,
  fontVariantNumeric: 'tabular-nums',
};

const MEMBER_STICKY_NAME_COL_W = 'clamp(92px, 20vw, 146px)';
const MEMBER_STICKY_EXERCISE_COL_W = 'clamp(24px, 6vw, 32px)';

const memberStickyNameCell: CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  minWidth: MEMBER_STICKY_NAME_COL_W,
  width: MEMBER_STICKY_NAME_COL_W,
  maxWidth: MEMBER_STICKY_NAME_COL_W,
  background: '#fff',
};

const memberStickyNameHead: CSSProperties = {
  ...memberStickyNameCell,
  zIndex: 4,
  background: '#f3f4f6',
};

const memberStickyExerciseCell: CSSProperties = {
  position: 'sticky',
  left: MEMBER_STICKY_NAME_COL_W,
  zIndex: 2,
  minWidth: MEMBER_STICKY_EXERCISE_COL_W,
  width: MEMBER_STICKY_EXERCISE_COL_W,
  maxWidth: MEMBER_STICKY_EXERCISE_COL_W,
  background: '#fff',
  textAlign: 'center',
};

const memberStickyExerciseHead: CSSProperties = {
  ...memberStickyExerciseCell,
  zIndex: 4,
  background: '#f3f4f6',
};

const memberNameCell: CSSProperties = {
  display: 'grid',
  gap: 4,
  minWidth: 0,
};

const memberNameText: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.1,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const memberRolePill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 999,
  padding: '2px 6px',
  background: 'rgba(15, 118, 110, 0.1)',
  color: '#0f766e',
  fontSize: 10,
  fontWeight: 900,
  width: 'fit-content',
};

const statsCheckboxLabel: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  whiteSpace: 'nowrap',
  fontSize: 12,
  fontWeight: 700,
  color: '#0f172a',
};

const exerciseIconStack: CSSProperties = {
  display: 'grid',
  gap: 1,
  justifyItems: 'center',
  alignContent: 'start',
};

const tableExerciseIcon: CSSProperties = {
  width: 11,
  height: 11,
  objectFit: 'contain',
  display: 'block',
};

const metricStack: CSSProperties = {
  display: 'grid',
  gap: 1,
  justifyItems: 'start',
  alignContent: 'start',
};

const metricValue: CSSProperties = {
  fontSize: 11,
  lineHeight: 1,
  fontWeight: 800,
  color: '#000',
  whiteSpace: 'nowrap',
};

const memberActionsCell: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  minWidth: 'max-content',
};

const heatmapWrap: CSSProperties = {
  display: 'grid',
  gap: 12,
};

const heatmapHint: CSSProperties = {
  fontSize: 12,
  color: '#475569',
};

const heatmapScroller: CSSProperties = {
  overflowX: 'auto',
  paddingBottom: 2,
};

const heatmapLayout: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '34px max-content',
  gap: 8,
  alignItems: 'start',
  width: 'max-content',
};

const heatmapWeekdayColumn: CSSProperties = {
  display: 'grid',
  gap: 6,
  paddingTop: 20,
};

const heatmapWeekdayLabel: CSSProperties = {
  height: 16,
  display: 'flex',
  alignItems: 'center',
  fontSize: 11,
  color: '#64748b',
};

const heatmapBody: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const heatmapWeekNumbersRow: CSSProperties = {
  display: 'grid',
  gridAutoFlow: 'column',
  gap: 6,
};

const heatmapWeekNumber: CSSProperties = {
  width: 16,
  minHeight: 12,
  fontSize: 10,
  color: '#64748b',
  textAlign: 'center',
};

const heatmapColumnsRow: CSSProperties = {
  display: 'grid',
  gridAutoFlow: 'column',
  gap: 6,
  width: 'max-content',
};

const heatmapWeekColumn: CSSProperties = {
  display: 'grid',
  gap: 6,
};

const heatmapCellButton: CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: 4,
  padding: 0,
};

const heatmapMetaGrid: CSSProperties = {
  display: 'grid',
  gap: 10,
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
};

const heatmapMetaBadge: CSSProperties = {
  borderRadius: 16,
  border: '1px solid rgba(15, 118, 110, 0.16)',
  background: '#fff',
  padding: '10px 12px',
};

const heatmapMetaLabel: CSSProperties = {
  fontSize: 11,
  color: '#64748b',
  fontWeight: 800,
};

const heatmapMetaValue: CSSProperties = {
  marginTop: 2,
  fontSize: 17,
  color: '#0f172a',
  fontWeight: 900,
};

const heatmapLegendRow: CSSProperties = {
  display: 'inline-flex',
  gap: 6,
  alignItems: 'center',
  flexWrap: 'wrap',
  fontSize: 11,
  color: '#64748b',
  fontWeight: 700,
};

const heatmapLegendSwatch: CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 4,
};

const feedHeaderRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
};

const feedLimitToggleRow: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const feedLimitToggleBtn: CSSProperties = {
  minWidth: 34,
  height: 30,
  borderRadius: 10,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(255, 255, 255, 0.82)',
  color: '#0f172a',
  fontSize: 13,
  fontWeight: 900,
  lineHeight: 1,
  cursor: 'pointer',
  padding: '0 8px',
};

const feedLimitToggleBtnActive: CSSProperties = {
  border: '1px solid rgba(249, 115, 22, 0.2)',
  background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
  color: '#fff',
};

const feedListWrap: CSSProperties = {
  display: 'grid',
  gap: 9,
};

const feedListWrapScrollable: CSSProperties = {
  maxHeight: 'clamp(380px, 58vh, 510px)',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  paddingRight: 3,
};

const feedDaySection: CSSProperties = {
  display: 'grid',
  gap: 6,
};

const feedDayTitle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  alignSelf: 'start',
  padding: '3px 10px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 900,
  color: '#334155',
  background: 'rgba(248, 250, 252, 0.96)',
  backdropFilter: 'saturate(160%) blur(8px)',
  boxShadow: '0 6px 18px rgba(15, 23, 42, 0.08)',
};

const feedTypeIcon: CSSProperties = {
  width: 18,
  height: 18,
  objectFit: 'contain',
  display: 'block',
  flex: '0 0 auto',
};

const feedRowCard: CSSProperties = {
  borderRadius: 20,
  padding: '10px 12px',
  boxShadow: '0 14px 30px rgba(15, 23, 42, 0.06)',
};

const feedRowGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto auto',
  gap: 6,
  alignItems: 'center',
};

const feedUserCell: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
};

const feedUserText: CSSProperties = {
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  fontSize: 12,
};

const feedUserName: CSSProperties = {
  fontWeight: 900,
  color: '#0f172a',
};

const feedUserTime: CSSProperties = {
  color: '#475569',
};

const feedReps: CSSProperties = {
  fontSize: 22,
  fontWeight: 900,
  color: '#0f172a',
  textAlign: 'right',
  minWidth: 44,
  whiteSpace: 'nowrap',
};


const modalBackdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.52)',
  display: 'grid',
  placeItems: 'center',
  padding: 16,
  zIndex: 50,
};

const modalCard: CSSProperties = {
  width: 'min(100%, 560px)',
  display: 'grid',
  gap: 14,
  padding: 20,
  borderRadius: 24,
  background: '#fff',
  boxShadow: '0 30px 80px rgba(15, 23, 42, 0.24)',
};

const modalActions: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
};
