'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { PERIOD_OPTIONS } from '@/lib/analytics/constants';
import { buildProgressAnalytics, getExerciseAccent } from '@/lib/analytics/selectors';
import type { ExerciseFilter, HeatmapCell, PeriodKey, WorkoutRecord } from '@/lib/analytics/types';
import { formatExerciseValue } from '@/lib/exercise-metrics';
import { useI18n } from '@/i18n/provider';
import { getIntlLocale, t } from '@/i18n/translate';

type MemberItem = {
  userId: string;
  isOwner: boolean;
  joinedAt: string;
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
  members: MemberItem[];
};

type GroupWorkout = {
  id: string;
  reps: number;
  date: string;
  time: string | null;
  exerciseType: string;
};

type DayAggregate = {
  items: GroupWorkout[];
  byExercise: Map<string, number>;
  totalReps: number;
};

type ProgramOverview = {
  activePrograms: Array<{
    id: string;
    exerciseType: string;
    targetReps: number | null;
    isActive: boolean;
    status: string;
    stats?: { completionPercent?: number };
  }>;
  history: Array<{
    id: string;
    exerciseType: string;
    targetReps: number | null;
    status: string;
    completionPercent: number;
  }>;
};

type ExerciseType = 'pushups' | 'pullups' | 'crunches' | 'squats' | 'plank';
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

function normalizeDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addCalendarMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function formatMonthTitle(date: Date, locale: string) {
  const raw = date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function toIsoTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
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

export default function GroupMemberDetailPage() {
  const { locale, messages } = useI18n();
  const localeTag = getIntlLocale(locale);
  const tt = useCallback((input: string) => t(locale, input), [locale]);
  const params = useParams<{ id: string; userId: string }>();
  const searchParams = useSearchParams();
  const groupId = String(params?.id || '');
  const memberId = String(params?.userId || '');
  const searchExercise = searchParams.get('exercise');
  const searchPeriod = searchParams.get('period');
  const searchMemberQuery = searchParams.get('memberQuery') || '';

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [member, setMember] = useState<MemberItem | null>(null);
  const [workouts, setWorkouts] = useState<GroupWorkout[]>([]);
  const [managedWorkouts, setManagedWorkouts] = useState<GroupWorkout[]>([]);
  const [programOverview, setProgramOverview] = useState<ProgramOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [exerciseFilter, setExerciseFilter] = useState<ExerciseFilter>(
    isExerciseFilterValue(searchExercise) ? searchExercise : 'all',
  );
  const [period, setPeriod] = useState<PeriodKey>(
    isPeriodKeyValue(searchPeriod) ? searchPeriod : '30d',
  );
  const [workoutDate, setWorkoutDate] = useState(todayDateString());
  const [workoutTime, setWorkoutTime] = useState(normalizeTime(new Date()));
  const [workoutExercise, setWorkoutExercise] = useState('pushups');
  const [workoutReps, setWorkoutReps] = useState('20');
  const [editingWorkoutId, setEditingWorkoutId] = useState('');
  const [programExercise, setProgramExercise] = useState('pushups');
  const [programBaseline, setProgramBaseline] = useState('20');
  const [programTarget, setProgramTarget] = useState('30');
  const [programDuration, setProgramDuration] = useState('');
  const [programFrequency, setProgramFrequency] = useState('');
  const [feedPeriod, setFeedPeriod] = useState<PeriodKey>('30d');
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => monthStart(new Date()));
  const [calendarMonthInitialized, setCalendarMonthInitialized] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailDay, setDetailDay] = useState<string | null>(null);
  const [ownerExitOpen, setOwnerExitOpen] = useState(false);
  const [ownershipUserId, setOwnershipUserId] = useState('');

  const deferredExerciseFilter = useDeferredValue(exerciseFilter);
  const deferredPeriod = useDeferredValue(period);
  const deferredFeedPeriod = useDeferredValue(feedPeriod);

  const canManageMember = Boolean(group?.canManage && member && (!member.isOwner || !group?.isOwner));

  const memberIndex = useMemo(
    () => (group?.members || []).findIndex((candidate) => candidate.userId === memberId),
    [group?.members, memberId],
  );
  const previousMember = memberIndex > 0 ? group?.members[memberIndex - 1] ?? null : null;
  const nextMember = memberIndex >= 0 ? group?.members[memberIndex + 1] ?? null : null;

  const loadProgramOverview = useCallback(async () => {
    if (!canManageMember || !memberId) {
      setProgramOverview(null);
      return;
    }
    const payload = await fetchJsonSafe<ProgramOverview>(`/api/groups/${groupId}/programs?userId=${encodeURIComponent(memberId)}`);
    setProgramOverview(payload);
  }, [canManageMember, groupId, memberId]);

  const load = useCallback(async () => {
    if (!groupId || !memberId) return;
    setLoading(true);
    setError(null);
    try {
      const [groupRes, workoutsRes] = await Promise.all([
        fetchJsonSafe<{ group: GroupDetail }>(`/api/groups/${groupId}`),
        fetchJsonSafe<{ byUser: Record<string, GroupWorkout[]> }>(
          `/api/groups/${groupId}/workouts?userId=${encodeURIComponent(memberId)}`,
        ),
      ]);

      const nextMember = groupRes.group.members.find((candidate) => candidate.userId === memberId) || null;
      setGroup(groupRes.group);
      setMember(nextMember);
      setWorkouts(nextMember ? (workoutsRes.byUser[nextMember.user.username] || []) : []);

      if (groupRes.group.canManage && nextMember && (!nextMember.isOwner || !groupRes.group.isOwner)) {
        const [programsRes, managedRes] = await Promise.all([
          fetchJsonSafe<ProgramOverview>(`/api/groups/${groupId}/programs?userId=${encodeURIComponent(memberId)}`),
          fetchJsonSafe<GroupWorkout[]>(`/api/workouts?userId=${encodeURIComponent(memberId)}&groupId=${encodeURIComponent(groupId)}`),
        ]);
        setProgramOverview(programsRes);
        setManagedWorkouts(Array.isArray(managedRes) ? managedRes : []);
      } else {
        setProgramOverview(null);
        setManagedWorkouts([]);
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [groupId, memberId]);

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

  const analytics = useMemo(
    () =>
      buildProgressAnalytics({
        workouts: workouts as WorkoutRecord[],
        exercise: deferredExerciseFilter,
        period: deferredPeriod,
        copy: messages.progress,
      }),
    [deferredExerciseFilter, deferredPeriod, messages.progress, workouts],
  );

  const dayMap = useMemo(() => {
    const map = new Map<string, DayAggregate>();
    workouts.forEach((workout) => {
      const key = normalizeDate(new Date(workout.time || workout.date));
      const row = map.get(key) || { items: [], byExercise: new Map<string, number>(), totalReps: 0 };
      row.items.push(workout);
      const exerciseType = toExerciseType(workout.exerciseType);
      row.byExercise.set(exerciseType, (row.byExercise.get(exerciseType) ?? 0) + (workout.reps || 0));
      row.totalReps += workout.reps || 0;
      map.set(key, row);
    });

    for (const row of map.values()) {
      row.items.sort((left, right) => new Date(right.time || right.date).getTime() - new Date(left.time || left.date).getTime());
    }

    return map;
  }, [workouts]);

  const calendarCells = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const mondayOffset = (first.getDay() + 6) % 7;
    const out: Array<{ key: string; day: number } | null> = [];

    for (let index = 0; index < mondayOffset; index += 1) out.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      out.push({ key: normalizeDate(new Date(year, month, day)), day });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [calendarMonth]);

  const groupedRecentWorkouts = useMemo(() => {
    const filtered = workouts
      .filter((workout) => deferredExerciseFilter === 'all' || workout.exerciseType === deferredExerciseFilter)
      .filter((workout) => isWorkoutInPeriod(workout, deferredFeedPeriod))
      .sort((left, right) => new Date(right.time || right.date).getTime() - new Date(left.time || left.date).getTime());

    const groups = new Map<string, GroupWorkout[]>();
    filtered.forEach((workout) => {
      const dayKey = normalizeDate(new Date(workout.time || workout.date));
      const bucket = groups.get(dayKey) ?? [];
      bucket.push(workout);
      groups.set(dayKey, bucket);
    });

    return Array.from(groups.entries()).map(([dayKey, items]) => ({
      dayKey,
      items,
    }));
  }, [deferredExerciseFilter, deferredFeedPeriod, workouts]);

  const memberRouteQuery = useMemo(() => {
    const query = new URLSearchParams();
    query.set('exercise', exerciseFilter);
    query.set('period', period);
    if (searchMemberQuery.trim()) query.set('memberQuery', searchMemberQuery.trim());
    return query.toString();
  }, [exerciseFilter, period, searchMemberQuery]);

  const backToGroupHref = useMemo(() => {
    const query = new URLSearchParams();
    query.set('exercise', exerciseFilter);
    query.set('period', period);
    query.set('spotlight', memberId);
    if (searchMemberQuery.trim()) query.set('memberQuery', searchMemberQuery.trim());
    return `/groups/${groupId}?${query.toString()}`;
  }, [exerciseFilter, groupId, memberId, period, searchMemberQuery]);

  const weekdays = useMemo(() => ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(tt), [tt]);
  const todayKey = useMemo(() => normalizeDate(new Date()), []);
  const selectedDayData = detailDay ? dayMap.get(detailDay) ?? null : null;

  useEffect(() => {
    if (calendarMonthInitialized || !workouts.length) return;
    const latestWorkout = workouts.reduce<GroupWorkout | null>((latest, workout) => {
      if (!latest) return workout;
      return new Date(workout.time || workout.date).getTime() > new Date(latest.time || latest.date).getTime() ? workout : latest;
    }, null);
    if (!latestWorkout) return;
    setCalendarMonth(monthStart(new Date(latestWorkout.time || latestWorkout.date)));
    setCalendarMonthInitialized(true);
  }, [calendarMonthInitialized, workouts]);

  function closeDetails() {
    setDetailsOpen(false);
    setDetailDay(null);
  }

  function resetWorkoutForm() {
    setEditingWorkoutId('');
    setWorkoutDate(todayDateString());
    setWorkoutTime(normalizeTime(new Date()));
    setWorkoutExercise('pushups');
    setWorkoutReps('20');
  }

  function startEditWorkout(workout: GroupWorkout) {
    setEditingWorkoutId(workout.id);
    setWorkoutDate(normalizeDate(new Date(workout.time || workout.date)));
    setWorkoutTime(normalizeTime(new Date(workout.time || workout.date)));
    setWorkoutExercise(workout.exerciseType);
    setWorkoutReps(String(workout.reps));
  }

  async function saveManagedWorkout(event: FormEvent) {
    event.preventDefault();
    if (!canManageMember) return;
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe('/api/workouts', {
        method: editingWorkoutId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingWorkoutId || undefined,
          userId: memberId,
          groupId,
          reps: Number(workoutReps),
          date: workoutDate,
          time: toIsoTime(workoutDate, workoutTime),
          exerciseType: workoutExercise,
        }),
      });
      setInfo(editingWorkoutId ? tt('Изменения сохранены') : tt('Добавлено'));
      resetWorkoutForm();
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function deleteManagedWorkout(workoutId: string) {
    if (!canManageMember) return;
    if (!window.confirm(tt('Удалить эту запись?'))) return;
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe('/api/workouts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: workoutId, groupId }),
      });
      setInfo(tt('Запись удалена'));
      if (editingWorkoutId === workoutId) resetWorkoutForm();
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function createProgram(event: FormEvent) {
    event.preventDefault();
    if (!canManageMember) return;
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe(`/api/groups/${groupId}/programs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: memberId,
          exerciseType: programExercise,
          baselineMaxReps: Number(programBaseline),
          targetReps: Number(programTarget),
          durationWeeks: programDuration ? Number(programDuration) : undefined,
          frequencyPerWeek: programFrequency ? Number(programFrequency) : undefined,
        }),
      });
      setInfo(tt('Программа создана'));
      await loadProgramOverview();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function deactivateProgram(programId: string) {
    if (!canManageMember) return;
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe(`/api/groups/${groupId}/programs/${programId}/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: memberId }),
      });
      setInfo(tt('Программа прервана'));
      await loadProgramOverview();
    } catch (e) {
      setError(getErrorMessage(e));
    }
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

  if (loading) {
    return <div className="app-page" style={page}><p style={loadingBanner}>{tt('Загрузка…')}</p></div>;
  }

  if (!group || !member) {
    return <div className="app-page" style={page}><p style={errorBanner}>{error || tt('Участник не найден')}</p></div>;
  }

  return (
    <div className="app-page" style={page}>
      <section style={heroCard}>
        <div style={heroCopy}>
          <div style={breadcrumbs}>
            <Link href="/groups" style={linkInline}>{tt('Группы')}</Link>
            <span style={metaLine}>/</span>
            <Link href={backToGroupHref} style={linkInline}>{tt('Обзор')}</Link>
            <span style={metaLine}>/</span>
            <span style={metaLine}>{member.user.username}</span>
          </div>
          <div style={eyebrow}>{tt('Участник группы')}</div>
          <h1 style={heroTitle}>{member.user.username}</h1>
          <p style={heroText}>{member.isOwner ? tt('Владелец') : tt('Участник')}</p>
        </div>
        <div style={heroActions}>
          {previousMember ? (
            <Link href={`/groups/${group.id}/members/${previousMember.userId}?${memberRouteQuery}`} style={linkButton}>
              ← {previousMember.user.username}
            </Link>
          ) : null}
          {nextMember ? (
            <Link href={`/groups/${group.id}/members/${nextMember.userId}?${memberRouteQuery}`} style={linkButton}>
              {nextMember.user.username} →
            </Link>
          ) : null}
        </div>
        <div style={chipWrap}>
          {group.members.map((candidate) => (
            <Link
              key={candidate.userId}
              href={`/groups/${group.id}/members/${candidate.userId}?${memberRouteQuery}`}
              style={{
                ...memberChip,
                borderColor: candidate.userId === member.userId ? '#0f766e' : 'rgba(148, 163, 184, 0.32)',
                background: candidate.userId === member.userId ? 'rgba(240, 253, 250, 0.96)' : 'rgba(255,255,255,0.96)',
              }}
            >
              {candidate.user.username}
            </Link>
          ))}
        </div>
      </section>

      {error ? <p style={errorBanner}>{error}</p> : null}
      {info ? <p style={infoBanner}>{info}</p> : null}

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
                onClick={() => startTransition(() => setExerciseFilter(filter))}
                style={{
                  ...filterPill,
                  borderColor: filter === exerciseFilter ? getExerciseAccent(filter) : 'rgba(148, 163, 184, 0.32)',
                  background: filter === exerciseFilter ? 'rgba(255,255,255,0.98)' : 'rgba(248, 250, 252, 0.88)',
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
                onClick={() => startTransition(() => setPeriod(option.key))}
                style={{
                  ...filterPill,
                  borderColor: option.key === period ? '#0f766e' : 'rgba(148, 163, 184, 0.32)',
                  background: option.key === period ? 'rgba(240, 253, 250, 0.96)' : 'rgba(248, 250, 252, 0.88)',
                }}
              >
                {getPeriodLabel(option.key, messages.progress)}
              </button>
            ))}
          </div>
        </div>

        {!analytics.hasDataInRange ? (
          <div style={emptyCard}>{messages.progress.states.noDataPeriodBody}</div>
        ) : (
          <>
            <div style={analyticsGrid}>
              {analytics.kpis.slice(0, 5).map((cardItem) => (
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
                  {analytics.volumeSeries.slice(-14).map((point) => {
                    const maxValue = Math.max(1, ...analytics.volumeSeries.map((seriesPoint) => seriesPoint.value));
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
                        />
                        <span style={trendLabel}>{point.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={subCard}>
                <h3 style={subTitle}>{messages.progress.sections.activityCalendar}</h3>
                <ActivityHeatmap
                  cells={analytics.heatmap}
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
            </div>
          </>
        )}
      </section>

      {canManageMember ? (
        <section style={card}>
          <div style={{ display: 'grid', gap: 6 }}>
            <h2 style={sectionTitle}>{tt('Календарь записей')}</h2>
            <p style={metaLine}>{tt('Календарный вид тренировок участника по дням месяца.')}</p>
          </div>

          <div style={calendarNavWrap}>
            <div style={{ fontWeight: 900, fontSize: 18, textAlign: 'center' }}>{formatMonthTitle(calendarMonth, localeTag)}</div>
            <div style={calendarNavButtons}>
              <button type="button" style={btnSecondary} onClick={() => setCalendarMonth((value) => addCalendarMonths(value, -1))}>
                {tt('Предыдущий')}
              </button>
              <button type="button" style={btnSecondary} onClick={() => setCalendarMonth((value) => addCalendarMonths(value, 1))}>
                {tt('Следующий')}
              </button>
            </div>
          </div>

          <div style={calendarGrid}>
            {weekdays.map((day) => (
              <div key={day} style={calendarWeekdayCell}>{day}</div>
            ))}

            {calendarCells.map((cell, index) => {
              if (!cell) return <div key={`member-calendar-empty-${index}`} style={calendarEmptyCell} />;

              const row = dayMap.get(cell.key);
              const hasData = Boolean(row && row.items.length);
              const active = detailsOpen && detailDay === cell.key;
              const isToday = cell.key === todayKey;
              const dayDate = new Date(`${cell.key}T00:00:00`);
              const dayOfWeek = dayDate.getDay();
              const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
              const exerciseTotals = (['pushups', 'pullups', 'crunches', 'squats', 'plank'] as ExerciseType[])
                .map((type) => ({ type, sum: row?.byExercise.get(type) ?? 0 }))
                .filter((item) => item.sum > 0);

              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => {
                    if (!hasData) return;
                    setDetailDay(cell.key);
                    setDetailsOpen(true);
                  }}
                  style={{
                    ...calendarDayCell,
                    background: isWeekend
                      ? 'linear-gradient(rgba(244, 114, 182, 0.12), rgba(244, 114, 182, 0.12)), #ffffff'
                      : '#ffffff',
                    borderColor: isToday ? '#16a34a' : active ? '#2563eb' : hasData ? '#d1d5db' : '#f3f4f6',
                    boxShadow: isToday ? 'inset 0 0 0 1px #16a34a' : '0 12px 24px rgba(15, 23, 42, 0.04)',
                    cursor: hasData ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ fontWeight: 900, textAlign: 'left', color: '#000' }}>{cell.day}</div>
                  <div style={exerciseNumbersRow}>
                    {exerciseTotals.map(({ type, sum }) => (
                      <span key={`${cell.key}-${type}`} style={exerciseNumberItem}>
                        <Image src={exerciseFeedIcon(type)} alt={exerciseLabel(type, messages.nav.exercise) || type} width={22} height={22} style={exerciseNumberIcon} unoptimized />
                        <span style={exerciseNumber}>{formatExerciseValue(sum, type, true)}</span>
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={legendWrap}>
            {(['pushups', 'pullups', 'crunches', 'squats', 'plank'] as ExerciseType[]).map((type) => (
              <div key={type} style={legendItem}>
                <Image src={exerciseFeedIcon(type)} alt={exerciseLabel(type, messages.nav.exercise) || type} width={20} height={20} style={legendIcon} unoptimized />
                <span>{exerciseLabel(type, messages.nav.exercise) || type}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section style={card}>
        <div style={feedHeaderRow}>
          <h2 style={{ ...sectionTitle, marginBottom: 0 }}>{tt('Последние тренировки участника')}</h2>
          <div role="group" aria-label={tt('Период')} style={feedLimitToggleRow}>
            {FEED_PERIOD_OPTIONS.map((periodKey) => {
              const active = feedPeriod === periodKey;
              const label = periodKey === 'all' ? tt('Все') : tt(periodKey === '7d' ? '7д' : periodKey === '30d' ? '30д' : '90д');
              return (
                <button
                  key={`member-feed-period-${periodKey}`}
                  type="button"
                  onClick={() => setFeedPeriod(periodKey)}
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
        {groupedRecentWorkouts.length === 0 ? <div style={emptyCard}>{tt('Нет данных по выбранному участнику.')}</div> : null}
        {groupedRecentWorkouts.length > 0 ? (
          <div style={{ ...feedListWrap, ...feedListWrapScrollable }}>
            {groupedRecentWorkouts.map((groupedDay) => (
              <section key={`member-feed-${groupedDay.dayKey}`} style={feedDaySection}>
                <div style={feedDayTitle}>{formatDateWithWeekday(groupedDay.dayKey, localeTag)}</div>
                {groupedDay.items.map((workout) => {
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
                            <span style={feedUserName}>{member.user.username}</span>
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

      {canManageMember ? (
        <section style={card}>
          <h2 style={sectionTitle}>{tt('Управление тренировками участника')}</h2>
          <form onSubmit={saveManagedWorkout} style={stack}>
            <div style={gridCompact}>
              <input type="date" value={workoutDate} onChange={(event) => setWorkoutDate(event.target.value)} style={input} />
              <input type="time" value={workoutTime} onChange={(event) => setWorkoutTime(event.target.value)} style={input} />
            </div>
            <div style={gridCompact}>
              <select value={workoutExercise} onChange={(event) => setWorkoutExercise(event.target.value)} style={input}>
                <option value="pushups">pushups</option>
                <option value="pullups">pullups</option>
                <option value="crunches">crunches</option>
                <option value="squats">squats</option>
                <option value="plank">plank</option>
              </select>
              <input value={workoutReps} onChange={(event) => setWorkoutReps(event.target.value)} placeholder={tt('Повторы')} style={input} />
            </div>
            <div style={actionRow}>
              <button type="submit" style={btnPrimary}>{editingWorkoutId ? tt('Сохранить') : tt('Добавить')}</button>
              {editingWorkoutId ? <button type="button" style={btnSecondary} onClick={resetWorkoutForm}>{tt('Отмена')}</button> : null}
            </div>
          </form>

          <div style={stack}>
            {managedWorkouts.map((workout) => (
              <div key={workout.id} style={rowCard}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong>{exerciseLabel(workout.exerciseType as ExerciseFilter, messages.nav.exercise) || workout.exerciseType}</strong>
                  <span style={metaLine}>{formatExerciseValue(workout.reps, workout.exerciseType, true)} · {new Date(workout.time || workout.date).toLocaleString(localeTag)}</span>
                </div>
                <div style={actionRow}>
                  <button type="button" style={btnSecondary} onClick={() => startEditWorkout(workout)}>{tt('Редактировать')}</button>
                  <button type="button" style={btnDanger} onClick={() => void deleteManagedWorkout(workout.id)}>{tt('Удалить')}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {canManageMember ? (
        <section style={card}>
          <h2 style={sectionTitle}>{tt('Программы участников')}</h2>
          <form onSubmit={createProgram} style={stack}>
            <div style={gridCompact}>
              <label style={fieldGroup}>
                <span style={fieldLabel}>{tt('Упражнение программы')}</span>
                <select value={programExercise} onChange={(event) => setProgramExercise(event.target.value)} style={input}>
                  <option value="pushups">pushups</option>
                  <option value="pullups">pullups</option>
                  <option value="crunches">crunches</option>
                  <option value="squats">squats</option>
                  <option value="plank">plank</option>
                </select>
              </label>
              <label style={fieldGroup}>
                <span style={fieldLabel}>{tt('Стартовый максимум')}</span>
                <span style={fieldHint}>{tt('Текущий уровень участника в повторах или секундах.')}</span>
                <input value={programBaseline} onChange={(event) => setProgramBaseline(event.target.value)} placeholder={tt('Например: 20')} style={input} />
              </label>
            </div>
            <div style={gridCompact}>
              <label style={fieldGroup}>
                <span style={fieldLabel}>{tt('Целевой результат')}</span>
                <span style={fieldHint}>{tt('К какому максимуму программа должна привести участника.')}</span>
                <input value={programTarget} onChange={(event) => setProgramTarget(event.target.value)} placeholder={tt('Например: 30')} style={input} />
              </label>
              <label style={fieldGroup}>
                <span style={fieldLabel}>{tt('Длительность программы')}</span>
                <span style={fieldHint}>{tt('Количество недель. Поле необязательное.')}</span>
                <input value={programDuration} onChange={(event) => setProgramDuration(event.target.value)} placeholder={tt('Например: 8')} style={input} />
              </label>
            </div>
            <label style={fieldGroup}>
              <span style={fieldLabel}>{tt('Тренировок в неделю')}</span>
              <span style={fieldHint}>{tt('Сколько тренировочных дней в неделю планируется. Поле необязательное.')}</span>
              <input value={programFrequency} onChange={(event) => setProgramFrequency(event.target.value)} placeholder={tt('Например: 3')} style={input} />
            </label>
            <button type="submit" style={btnPrimary}>{tt('Назначить программу')}</button>
          </form>

          <div style={stack}>
            {(programOverview?.activePrograms || []).map((program) => (
              <div key={program.id} style={rowCard}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong>{program.exerciseType}</strong>
                  <span style={metaLine}>{tt('Статус')}: {program.status} · {tt('Прогресс')}: {program.stats?.completionPercent ?? 0}%</span>
                </div>
                <button type="button" style={btnSecondary} onClick={() => void deactivateProgram(program.id)}>{tt('Прервать')}</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {canManageMember && detailsOpen ? (
        <div style={modalBackdrop} onClick={closeDetails}>
          <section style={modalCardWide} onClick={(event) => event.stopPropagation()}>
            <div style={modalTop}>
              <h2 style={{ margin: 0 }}>{tt('Подходы за день')}</h2>
              <button type="button" style={btnSecondary} onClick={closeDetails}>
                {tt('Закрыть')}
              </button>
            </div>

            {!detailDay || !selectedDayData ? (
              <div style={{ color: '#6b7280' }}>{tt('Нет записей на выбранный день.')}</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ color: '#111827', fontWeight: 800 }}>
                  {formatDateWithWeekday(detailDay, localeTag)} · {tt('всего')}: {selectedDayData.totalReps}
                </div>

                {selectedDayData.items.map((workout) => {
                  const type = toExerciseType(workout.exerciseType);
                  return (
                    <div key={workout.id} style={calendarDetailsRowCard}>
                      <div style={{ display: 'grid', gap: 6 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Image src={exerciseFeedIcon(type)} alt={exerciseLabel(type, messages.nav.exercise) || type} width={16} height={16} style={detailsExerciseIcon} unoptimized />
                          <strong>{exerciseLabel(type, messages.nav.exercise) || type}</strong>
                        </div>
                        <span style={metaLine}>
                          {tt('Время')}: <b>{formatTimeHHMM(workout.time || workout.date)}</b>
                        </span>
                        <span style={metaLine}>{formatExerciseValue(workout.reps, type, true)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {ownerExitOpen ? (
        <div style={modalBackdrop} role="dialog" aria-modal="true">
          <div style={modalCard}>
            <h2 style={sectionTitle}>{tt('Выход владельца из группы')}</h2>
            <p style={heroText}>
              {tt('Перед выходом нужно либо передать права другому участнику, либо удалить группу целиком.')}
            </p>
            <select value={ownershipUserId} onChange={(event) => setOwnershipUserId(event.target.value)} style={input}>
              <option value="">{tt('Выберите участника')}</option>
              {group.members.filter((candidate) => !candidate.isOwner).map((candidate) => (
                <option key={candidate.userId} value={candidate.userId}>{candidate.user.username}</option>
              ))}
            </select>
            <div style={actionRow}>
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

const page: CSSProperties = {
  display: 'grid',
  gap: 18,
  maxWidth: 1080,
};

const heroCard: CSSProperties = {
  display: 'grid',
  gap: 16,
  padding: 'clamp(18px, 3vw, 28px)',
  borderRadius: 30,
  border: '1px solid rgba(14, 116, 144, 0.18)',
  background:
    'radial-gradient(circle at top right, rgba(16, 185, 129, 0.14), transparent 28%), linear-gradient(145deg, rgba(248, 250, 252, 0.96) 0%, rgba(255, 255, 255, 0.94) 52%, rgba(236, 253, 245, 0.9) 100%)',
  boxShadow: '0 28px 80px rgba(15, 23, 42, 0.12)',
};

const heroCopy: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const breadcrumbs: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const eyebrow: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#047857',
};

const heroTitle: CSSProperties = {
  margin: 0,
  color: '#0f172a',
  fontSize: 'clamp(28px, 4vw, 42px)',
  lineHeight: 0.98,
  fontWeight: 900,
  letterSpacing: '-0.05em',
};

const heroText: CSSProperties = {
  margin: 0,
  color: '#475569',
  lineHeight: 1.6,
};

const heroActions: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
};

const chipWrap: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
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

const actionRow: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
};

const memberChip: CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.32)',
  borderRadius: 999,
  padding: '10px 14px',
  fontWeight: 800,
  color: '#0f172a',
  textDecoration: 'none',
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

const modalBackdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.54)',
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  zIndex: 80,
};

const modalCard: CSSProperties = {
  width: 'min(100%, 460px)',
  display: 'grid',
  gap: 14,
  padding: 22,
  borderRadius: 24,
  border: '1px solid rgba(226, 232, 240, 0.95)',
  background: '#fff',
  boxShadow: '0 28px 70px rgba(15, 23, 42, 0.18)',
};

const modalCardWide: CSSProperties = {
  width: 'min(820px, 100%)',
  maxHeight: '88vh',
  overflowY: 'auto',
  display: 'grid',
  gap: 14,
  padding: 22,
  borderRadius: 24,
  border: '1px solid rgba(226, 232, 240, 0.95)',
  background: '#fff',
  boxShadow: '0 28px 70px rgba(15, 23, 42, 0.18)',
};

const modalTop: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  marginBottom: 10,
  flexWrap: 'wrap',
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

const calendarNavWrap: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const calendarNavButtons: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
};

const calendarGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  gap: 6,
};

const calendarWeekdayCell: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: '#000',
  textAlign: 'center',
  padding: '4px 0',
};

const calendarEmptyCell: CSSProperties = {
  minHeight: 'clamp(82px, 10.5vw, 120px)',
  border: '1px dashed rgba(226, 232, 240, 0.9)',
  borderRadius: 16,
  background: 'rgba(255, 255, 255, 0.72)',
};

const calendarDayCell: CSSProperties = {
  minHeight: 'clamp(82px, 10.5vw, 120px)',
  border: '1px solid rgba(226, 232, 240, 0.9)',
  borderRadius: 18,
  padding: '6px 6px 6px 3px',
  display: 'grid',
  gap: 4,
  alignContent: 'start',
  textAlign: 'left',
  overflow: 'hidden',
};

const exerciseNumbersRow: CSSProperties = {
  display: 'grid',
  gap: 1,
  alignContent: 'start',
  justifyItems: 'start',
  marginLeft: 0,
};

const exerciseNumber: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0,
  fontSize: 'clamp(10px, 0.78vw, 14px)',
  lineHeight: 1,
  fontWeight: 900,
  color: '#000',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

const exerciseNumberItem: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0,
  whiteSpace: 'nowrap',
  minWidth: 0,
};

const exerciseNumberIcon: CSSProperties = {
  width: 'clamp(12px, 0.95vw, 16px)',
  height: 'clamp(12px, 0.95vw, 16px)',
  objectFit: 'contain',
  flex: '0 0 auto',
  marginLeft: 0,
  marginRight: 1,
};

const legendWrap: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const legendItem: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'clamp(6px, 0.4vw, 8px)',
  fontSize: 'clamp(12px, 0.8vw, 14px)',
  fontWeight: 800,
  color: '#000',
};

const legendIcon: CSSProperties = {
  width: 'clamp(16px, 1vw, 20px)',
  height: 'clamp(16px, 1vw, 20px)',
  objectFit: 'contain',
  flex: '0 0 auto',
};

const detailsExerciseIcon: CSSProperties = {
  width: 16,
  height: 16,
  objectFit: 'contain',
  display: 'block',
  flex: '0 0 auto',
};

const calendarDetailsRowCard: CSSProperties = {
  border: '1px solid rgba(226, 232, 240, 0.92)',
  borderRadius: 18,
  background: 'rgba(255, 255, 255, 0.92)',
  padding: 12,
  boxShadow: '0 14px 32px rgba(15, 23, 42, 0.05)',
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

const linkInline: CSSProperties = {
  color: '#0f766e',
  textDecoration: 'none',
  fontWeight: 700,
};

const linkButton: CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.38)',
  borderRadius: 14,
  padding: '12px 16px',
  background: '#fff',
  color: '#0f172a',
  fontWeight: 700,
  textDecoration: 'none',
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
