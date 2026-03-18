import { EXERCISE_COLORS, EXERCISE_ORDER } from '@/lib/analytics/constants';
import { buildInsights } from '@/lib/analytics/insights';
import type { Messages } from '@/i18n/messages';
import { ruMessages } from '@/i18n/messages/ru';
import type {
  AnalyticsValue,
  ComparisonValue,
  ExerciseFilter,
  HeatmapCell,
  KpiCard,
  NormalizedWorkout,
  PeriodKey,
  PeriodRange,
  ProgressAnalytics,
  QualityMetric,
  TrendPoint,
  WorkoutRecord,
  WorkoutStructure,
} from '@/lib/analytics/types';
import {
  addDays,
  average,
  clamp,
  createZeroByExercise,
  formatDayLabel,
  getMetricForWorkout,
  getMetricKind,
  fillTemplate,
  normalizeDayKey,
  normalizeWorkouts,
  sampleStandardDeviation,
  startOfDay,
  sum,
} from '@/lib/analytics/utils';

type ProgressCopy = Messages['progress'];

function buildRange(
  workouts: NormalizedWorkout[],
  period: PeriodKey,
  todayInput?: Date,
): PeriodRange {
  const today = startOfDay(todayInput ?? new Date());

  if (period === 'all') {
    const firstDay = workouts.length ? startOfDay(workouts[0].performedAt) : today;
    const days = Math.max(1, Math.round((today.getTime() - firstDay.getTime()) / 86400000) + 1);
    return {
      key: period,
      start: firstDay,
      end: today,
      days,
      isAllTime: true,
      previous: null,
    };
  }

  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
  const start = addDays(today, -(days - 1));
  return {
    key: period,
    start,
    end: today,
    days,
    isAllTime: false,
    previous: {
      start: addDays(start, -days),
      end: addDays(start, -1),
      days,
    },
  };
}

function inRange(workout: NormalizedWorkout, start: Date, end: Date): boolean {
  const dayTime = workout.date.getTime();
  return dayTime >= start.getTime() && dayTime <= end.getTime();
}

function buildComparison(current: number, previous: number | null, allowComparison: boolean): ComparisonValue {
  if (!allowComparison || previous == null) {
    return {
      current,
      previous: null,
      delta: null,
      percent: null,
      available: false,
    };
  }

  if (previous === 0) {
    return {
      current,
      previous,
      delta: current,
      percent: null,
      available: false,
    };
  }

  return {
    current,
    previous,
    delta: current - previous,
    percent: ((current - previous) / previous) * 100,
    available: true,
  };
}

function buildTrendSeries(
  workouts: NormalizedWorkout[],
  range: PeriodRange,
  filter: ExerciseFilter,
): TrendPoint[] {
  const rows = new Map<string, TrendPoint>();
  for (let offset = 0; offset < range.days; offset += 1) {
    const date = addDays(range.start, offset);
    const key = normalizeDayKey(date);
    rows.set(key, {
      key,
      date,
      label: formatDayLabel(date),
      value: 0,
      bestSet: null,
      averageSet: null,
      setCount: 0,
      exerciseTotals: createZeroByExercise(() => 0),
      loadTotals: createZeroByExercise(() => 0),
    });
  }

  for (const workout of workouts) {
    const key = normalizeDayKey(workout.date);
    const row = rows.get(key);
    if (!row) continue;

    row.exerciseTotals[workout.exerciseType] += workout.reps;
    row.loadTotals[workout.exerciseType] += workout.load;
    row.value += getMetricForWorkout(workout, filter);
    row.setCount += 1;

    if (filter !== 'all') {
      row.bestSet = row.bestSet == null ? workout.reps : Math.max(row.bestSet, workout.reps);
      row.averageSet = row.averageSet == null ? workout.reps : row.averageSet + workout.reps;
    }
  }

  return Array.from(rows.values()).map((row) => ({
    ...row,
    averageSet: row.setCount > 0 && filter !== 'all' && row.averageSet != null ? row.averageSet / row.setCount : null,
  }));
}

function buildHeatmap(series: TrendPoint[]): HeatmapCell[] {
  const maxValue = Math.max(1, ...series.map((point) => point.value));
  return series.map((point, index) => ({
    key: point.key,
    date: point.date,
    value: point.value,
    intensity: point.value > 0 ? clamp(point.value / maxValue, 0.14, 1) : 0,
    label: point.label,
    weekIndex: Math.floor(index / 7),
    weekday: (point.date.getDay() + 6) % 7,
  }));
}

function buildWorkoutStructures(workouts: NormalizedWorkout[]): WorkoutStructure[] {
  const groups = new Map<string, WorkoutStructure>();

  for (const workout of workouts) {
    const fallbackKey = `day:${workout.exerciseType}:${normalizeDayKey(workout.date)}`;
    const id = workout.trainingSessionId ? `session:${workout.trainingSessionId}` : fallbackKey;
    const existing = groups.get(id);

    if (!existing) {
      groups.set(id, {
        id,
        label: normalizeDayKey(workout.date),
        date: workout.performedAt,
        total: workout.reps,
        durationSeconds: null,
        source: workout.trainingSessionId ? 'session' : 'day',
        sets: [{ id: workout.id, index: 1, value: workout.reps, performedAt: workout.performedAt }],
      });
      continue;
    }

    existing.total += workout.reps;
    existing.date = existing.date.getTime() > workout.performedAt.getTime() ? workout.performedAt : existing.date;
    existing.sets.push({
      id: workout.id,
      index: existing.sets.length + 1,
      value: workout.reps,
      performedAt: workout.performedAt,
    });
  }

  return Array.from(groups.values())
    .map((group) => {
      const sets = [...group.sets].sort((left, right) => left.performedAt.getTime() - right.performedAt.getTime())
        .map((set, index) => ({ ...set, index: index + 1 }));
      const durationSeconds =
        sets.length >= 2
          ? Math.max(0, Math.round((sets[sets.length - 1].performedAt.getTime() - sets[0].performedAt.getTime()) / 1000))
          : null;

      return {
        ...group,
        label: normalizeDayKey(startOfDay(group.date)),
        durationSeconds: durationSeconds && durationSeconds > 0 ? durationSeconds : null,
        sets,
      };
    })
    .sort((left, right) => right.date.getTime() - left.date.getTime());
}

function buildDistribution(workouts: NormalizedWorkout[]) {
  const totalByExercise = createZeroByExercise(() => 0);
  for (const workout of workouts) totalByExercise[workout.exerciseType] += workout.load;
  const totalLoad = sum(Object.values(totalByExercise));

  return EXERCISE_ORDER
    .map((exercise) => ({
      exercise,
      value: totalByExercise[exercise],
      share: totalLoad > 0 ? totalByExercise[exercise] / totalLoad : 0,
    }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value);
}

function buildQualityMetrics(
  workoutsInRange: NormalizedWorkout[],
  allScopedWorkouts: NormalizedWorkout[],
  copy: ProgressCopy,
): QualityMetric[] {
  const structures = buildWorkoutStructures(workoutsInRange);
  const densityValues = structures
    .map((workout) => (workout.durationSeconds && workout.durationSeconds > 0 ? workout.total / (workout.durationSeconds / 60) : null))
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 0);

  const fatigueValues = structures
    .map((workout) => {
      if (workout.sets.length < 2) return null;
      const first = workout.sets[0]?.value ?? 0;
      const last = workout.sets[workout.sets.length - 1]?.value ?? 0;
      if (first <= 0) return null;
      return ((first - last) / first) * 100;
    })
    .filter((value): value is number => value != null);

  const stabilityValues = structures
    .map((workout) => {
      if (workout.sets.length < 2) return null;
      const values = workout.sets.map((set) => set.value);
      const mean = average(values);
      const deviation = sampleStandardDeviation(values);
      if (!mean || deviation == null) return null;
      return clamp((1 - deviation / mean) * 100, 0, 100);
    })
    .filter((value): value is number => value != null);

  const personalRecord = Math.max(0, ...allScopedWorkouts.map((workout) => workout.reps));
  const heavyShare =
    workoutsInRange.length >= 3 && personalRecord > 0
      ? (workoutsInRange.filter((workout) => workout.reps >= personalRecord * 0.8).length / workoutsInRange.length) * 100
      : null;

  return [
    {
      id: 'density',
      label: copy.quality.density,
      state: densityValues.length ? 'ok' : 'hidden',
      metric: { value: average(densityValues), kind: 'rate' },
      note: densityValues.length ? copy.quality.densityNote : copy.quality.densityMissing,
    },
    {
      id: 'fatigueDrop',
      label: copy.quality.fatigueDrop,
      state: fatigueValues.length ? 'ok' : 'insufficient',
      metric: { value: average(fatigueValues), kind: 'percent' },
      note: fatigueValues.length ? copy.quality.fatigueDropNote : copy.quality.fatigueDropMissing,
    },
    {
      id: 'stability',
      label: copy.quality.stability,
      state: stabilityValues.length ? 'ok' : 'insufficient',
      metric: { value: average(stabilityValues), kind: 'percent' },
      note: stabilityValues.length ? copy.quality.stabilityNote : copy.quality.stabilityMissing,
    },
    {
      id: 'heavyShare',
      label: copy.quality.heavyShare,
      state: heavyShare == null ? 'insufficient' : 'ok',
      metric: { value: heavyShare, kind: 'percent' },
      note: heavyShare == null ? copy.quality.heavyShareMissing : copy.quality.heavyShareNote,
    },
  ];
}

function buildBestSetRecord(
  workouts: NormalizedWorkout[],
  filter: ExerciseFilter,
): { workout: NormalizedWorkout | null; metric: AnalyticsValue } {
  if (!workouts.length) return { workout: null, metric: { value: null, kind: getMetricKind(filter) } };

  const sorted = [...workouts].sort((left, right) => {
    const leftValue = getMetricForWorkout(left, filter);
    const rightValue = getMetricForWorkout(right, filter);
    if (rightValue !== leftValue) return rightValue - leftValue;
    return right.performedAt.getTime() - left.performedAt.getTime();
  });

  return {
    workout: sorted[0],
    metric: { value: getMetricForWorkout(sorted[0], filter), kind: getMetricKind(filter) },
  };
}

function buildKpis(params: {
  workoutsInRange: NormalizedWorkout[];
  filter: ExerciseFilter;
  currentTotal: number;
  previousTotal: number | null;
  trainingDays: number;
  totalSets: number;
  bestSetMetric: AnalyticsValue;
  averageSetValue: number | null;
  streakDays: number;
  copy: ProgressCopy;
}): KpiCard[] {
  const {
    workoutsInRange,
    filter,
    currentTotal,
    previousTotal,
    trainingDays,
    totalSets,
    bestSetMetric,
    averageSetValue,
    streakDays,
    copy,
  } = params;
  const comparison = buildComparison(currentTotal, previousTotal, previousTotal != null && previousTotal > 0);
  const averageMetric: AnalyticsValue = { value: averageSetValue, kind: getMetricKind(filter) };

  return [
    {
      id: 'trainingDays',
      label: copy.kpi.trainingDays,
      metric: { value: trainingDays, kind: 'count' },
      note: copy.kpi.trainingDaysNote,
      accent: '#1d4ed8',
    },
    {
      id: 'totalSets',
      label: copy.kpi.totalSets,
      metric: { value: totalSets, kind: 'count' },
      note: workoutsInRange.length
        ? fillTemplate(copy.kpi.totalSetsNote, { value: Math.round(totalSets / Math.max(trainingDays, 1)) })
        : copy.kpi.totalSetsEmpty,
      accent: '#0f766e',
    },
    {
      id: 'totalVolume',
      label: copy.kpi.totalVolume,
      metric: { value: currentTotal, kind: getMetricKind(filter) },
      note: filter === 'all' ? copy.kpi.totalVolumeLoadNote : copy.kpi.totalVolumeExerciseNote,
      comparison,
      accent: '#c2410c',
    },
    {
      id: 'bestSet',
      label: copy.kpi.bestSet,
      metric: bestSetMetric,
      note: filter === 'all' ? copy.kpi.bestSetLoadNote : copy.kpi.bestSetExerciseNote,
      accent: '#be185d',
    },
    {
      id: 'averageSet',
      label: copy.kpi.averageSet,
      metric: averageMetric,
      note: workoutsInRange.length ? copy.kpi.averageSetNote : copy.kpi.averageSetEmpty,
      accent: '#6d28d9',
    },
    {
      id: 'streak',
      label: copy.kpi.streak,
      metric: { value: streakDays, kind: 'count' },
      note: copy.kpi.streakNote,
      accent: '#0369a1',
    },
    {
      id: 'periodProgress',
      label: copy.kpi.periodProgress,
      metric: { value: comparison.percent, kind: 'percent' },
      note:
        previousTotal == null
          ? copy.kpi.periodProgressAllTime
          : previousTotal === 0
            ? copy.kpi.periodProgressNoPrevious
            : fillTemplate(copy.kpi.periodProgressCompared, { value: Math.round(previousTotal) }),
      comparison,
      accent: comparison.percent != null && comparison.percent >= 0 ? '#15803d' : '#b91c1c',
    },
  ];
}

function calculateStreak(workouts: NormalizedWorkout[], todayInput?: Date): number {
  if (!workouts.length) return 0;
  const today = startOfDay(todayInput ?? new Date());
  const days = new Set(workouts.map((workout) => normalizeDayKey(workout.date)));
  let cursor = today;
  let streak = 0;

  while (days.has(normalizeDayKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return streak;
}

export function buildProgressAnalytics(params: {
  workouts: WorkoutRecord[];
  exercise: ExerciseFilter;
  period: PeriodKey;
  today?: Date;
  copy?: ProgressCopy;
}): ProgressAnalytics {
  const copy = params.copy ?? ruMessages.progress;
  const normalized = normalizeWorkouts(params.workouts);
  const scopedAll = params.exercise === 'all'
    ? normalized
    : normalized.filter((workout) => workout.exerciseType === params.exercise);
  const range = buildRange(scopedAll, params.period, params.today);
  const workoutsInRange = scopedAll.filter((workout) => inRange(workout, range.start, range.end));
  const previousWorkouts = range.previous
    ? scopedAll.filter((workout) => inRange(workout, range.previous!.start, range.previous!.end))
    : [];

  const totalValue = sum(workoutsInRange.map((workout) => getMetricForWorkout(workout, params.exercise)));
  const previousTotal = range.previous
    ? sum(previousWorkouts.map((workout) => getMetricForWorkout(workout, params.exercise)))
    : null;
  const trainingDays = new Set(workoutsInRange.map((workout) => normalizeDayKey(workout.date))).size;
  const totalSets = workoutsInRange.length;
  const bestSet = buildBestSetRecord(workoutsInRange, params.exercise);
  const averageSetValue = workoutsInRange.length
    ? average(workoutsInRange.map((workout) => getMetricForWorkout(workout, params.exercise)))
    : null;
  const volumeSeries = buildTrendSeries(workoutsInRange, range, params.exercise);
  const streakDays = calculateStreak(scopedAll, params.today);
  const workoutStructures = params.exercise === 'all' ? [] : buildWorkoutStructures(workoutsInRange);

  const analytics: ProgressAnalytics = {
    filter: params.exercise,
    range,
    hasAnyData: scopedAll.length > 0,
    hasDataInRange: workoutsInRange.length > 0,
    totalValue: { value: totalValue, kind: getMetricKind(params.exercise) },
    previousTotalValue: previousTotal == null ? null : { value: previousTotal, kind: getMetricKind(params.exercise) },
    kpis: buildKpis({
      workoutsInRange,
      filter: params.exercise,
      currentTotal: totalValue,
      previousTotal,
      trainingDays,
      totalSets,
      bestSetMetric: bestSet.metric,
      averageSetValue,
      streakDays,
      copy,
    }),
    volumeSeries,
    bestSetSeries: params.exercise === 'all' ? [] : volumeSeries.filter((point) => point.bestSet != null),
    averageSetSeries: params.exercise === 'all' ? [] : volumeSeries.filter((point) => point.averageSet != null),
    heatmap: buildHeatmap(volumeSeries),
    distribution: params.exercise === 'all' ? buildDistribution(workoutsInRange) : [],
    qualityMetrics: params.exercise === 'all' ? [] : buildQualityMetrics(workoutsInRange, scopedAll, copy),
    workouts: workoutStructures,
    selectedWorkoutId: workoutStructures[0]?.id ?? null,
    insights: [],
    bestSetRecord: bestSet.workout,
    averageSetValue,
    streakDays,
    trainingDays,
    totalSets,
  };

  analytics.insights = buildInsights(analytics, copy);
  return analytics;
}

export function getExerciseAccent(filter: ExerciseFilter): string {
  return filter === 'all' ? '#b45309' : EXERCISE_COLORS[filter];
}
