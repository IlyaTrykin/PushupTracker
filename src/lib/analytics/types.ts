export type ExerciseType = 'pushups' | 'pullups' | 'crunches' | 'squats' | 'plank';
export type ExerciseFilter = ExerciseType | 'all';
export type PeriodKey = '7d' | '30d' | '90d' | 'all';
export type MetricKind = 'count' | 'exercise' | 'load' | 'percent' | 'duration' | 'rate';
export type DataState = 'ok' | 'insufficient' | 'hidden';

export type WorkoutRecord = {
  id: string;
  reps: number;
  date: string | Date;
  time?: string | Date | null;
  exerciseType?: string | null;
  trainingSessionId?: string | null;
};

export type NormalizedWorkout = {
  id: string;
  reps: number;
  exerciseType: ExerciseType;
  date: Date;
  performedAt: Date;
  trainingSessionId: string | null;
  load: number;
};

export type AnalyticsValue = {
  value: number | null;
  kind: MetricKind;
};

export type ComparisonValue = {
  current: number;
  previous: number | null;
  delta: number | null;
  percent: number | null;
  available: boolean;
};

export type KpiCard = {
  id: string;
  label: string;
  metric: AnalyticsValue;
  note?: string;
  comparison?: ComparisonValue;
  accent: string;
};

export type PeriodRange = {
  key: PeriodKey;
  start: Date;
  end: Date;
  days: number;
  isAllTime: boolean;
  previous: {
    start: Date;
    end: Date;
    days: number;
  } | null;
};

export type DistributionItem = {
  exercise: ExerciseType;
  value: number;
  share: number;
};

export type TrendPoint = {
  key: string;
  date: Date;
  label: string;
  value: number;
  bestSet: number | null;
  averageSet: number | null;
  setCount: number;
  exerciseTotals: Record<ExerciseType, number>;
  loadTotals: Record<ExerciseType, number>;
};

export type HeatmapCell = {
  key: string;
  date: Date;
  value: number;
  intensity: number;
  label: string;
  weekIndex: number;
  weekday: number;
};

export type QualityMetric = {
  id: string;
  label: string;
  state: DataState;
  metric: AnalyticsValue;
  note: string;
};

export type WorkoutStructureSet = {
  id: string;
  index: number;
  value: number;
  performedAt: Date;
};

export type WorkoutStructure = {
  id: string;
  label: string;
  date: Date;
  total: number;
  durationSeconds: number | null;
  source: 'session' | 'day';
  sets: WorkoutStructureSet[];
};

export type Insight = {
  id: string;
  tone: 'positive' | 'neutral' | 'warning';
  text: string;
};

export type ProgressAnalytics = {
  filter: ExerciseFilter;
  range: PeriodRange;
  hasAnyData: boolean;
  hasDataInRange: boolean;
  totalValue: AnalyticsValue;
  previousTotalValue: AnalyticsValue | null;
  kpis: KpiCard[];
  volumeSeries: TrendPoint[];
  bestSetSeries: TrendPoint[];
  averageSetSeries: TrendPoint[];
  heatmap: HeatmapCell[];
  distribution: DistributionItem[];
  qualityMetrics: QualityMetric[];
  workouts: WorkoutStructure[];
  selectedWorkoutId: string | null;
  insights: Insight[];
  bestSetRecord: NormalizedWorkout | null;
  averageSetValue: number | null;
  streakDays: number;
  trainingDays: number;
  totalSets: number;
};
