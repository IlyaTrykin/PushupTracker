// Данные тела в профиле (вес, рост, дата рождения, пол) и правило, по которому
// значения из Apple Health / Health Connect попадают в профиль (R04, R05).
// Вес и рост храним целыми (кг, см): точности до единицы для калорий достаточно.

export type BodyMetricSource = 'manual' | 'health';
export type BodySex = 'male' | 'female' | 'other';

export type NumberRange = { min: number; max: number };
export const WEIGHT_RANGE_KG: NumberRange = { min: 30, max: 250 };
export const HEIGHT_RANGE_CM: NumberRange = { min: 100, max: 250 };

/**
 * Что сейчас в профиле (`*UpdatedAt` — последнее изменение значения, ручное или из Health).
 * У профилей до появления `*UpdatedAt` дата сравнения берётся из истории профиля
 * (`*LastChangedAt` — последняя запись `UserProfileHistory` с этим полем), иначе `profileUpdatedAt`.
 */
export type CurrentBodyMetrics = {
  weightKg: number | null;
  weightUpdatedAt: Date | null;
  heightCm: number | null;
  heightUpdatedAt: Date | null;
  birthDate: Date | string | null;
  gender: string | null;
  weightLastChangedAt?: Date | null;
  heightLastChangedAt?: Date | null;
  profileUpdatedAt?: Date | null;
};

/** Что прочитано из Health (тело `POST /api/profile/body-metrics`); даты — ISO. */
export type HealthBodyMetrics = {
  weightKg?: number | null;
  weightMeasuredAt?: string | Date | null;
  heightCm?: number | null;
  heightMeasuredAt?: string | Date | null;
  /** YYYY-MM-DD (только iOS). */
  birthDate?: string | null;
  /** Только iOS. */
  sex?: BodySex | null;
};

/** Поля `User` к записи; пустой объект — менять нечего. */
export type BodyMetricUpdates = {
  weightKg?: number;
  weightUpdatedAt?: Date;
  weightSource?: BodyMetricSource;
  heightCm?: number;
  heightUpdatedAt?: Date;
  heightSource?: BodyMetricSource;
  /** YYYY-MM-DD */
  birthDate?: string;
  gender?: BodySex;
};

const SEXES: readonly BodySex[] = ['male', 'female', 'other'];

/** Целое в диапазоне или null, если значение не годится. */
function roundInRange(value: unknown, range: NumberRange): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded >= range.min && rounded <= range.max ? rounded : null;
}

/**
 * Поле формы профиля: `undefined` — не передано, `null`/'' — очистить,
 * число (в т.ч. строкой) — округляется до целого и проверяется по диапазону.
 */
export function parseBodyMetricInput(
  value: unknown,
  range: NumberRange,
): { ok: true; value: number | null | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || (typeof value === 'string' && value.trim() === '')) return { ok: true, value: null };
  const rounded = roundInRange(value, range);
  return rounded === null ? { ok: false } : { ok: true, value: rounded };
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateOnly(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  return value.slice(0, 10) || null;
}

function parseBirthDate(value: string | null | undefined, now: Date): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  if (d.getUTCFullYear() < 1900 || d.getTime() > now.getTime()) return null;
  return value;
}

/**
 * Одно измерение (вес или рост): заполняет пустое поле; заполненное заменяет,
 * только если замер строго новее даты сравнения (`*UpdatedAt`, иначе дата из истории,
 * иначе `User.updatedAt`). Замер без даты только заполняет пустое поле.
 */
function pickMeasurement(
  currentValue: number | null,
  comparedAt: Date | null,
  value: number | null | undefined,
  measuredAt: string | Date | null | undefined,
  range: NumberRange,
  now: Date,
): { value: number; updatedAt: Date } | null {
  const next = roundInRange(value, range);
  if (next === null) return null;
  const measured = toDate(measuredAt);
  const stamp = measured && measured.getTime() < now.getTime() ? measured : now;
  if (currentValue === null) return { value: next, updatedAt: stamp };
  if (!measured) return null;
  if (comparedAt && stamp.getTime() <= comparedAt.getTime()) return null;
  return { value: next, updatedAt: stamp };
}

/**
 * Правило R04.1/R05: вес и рост из Health заменяют профиль, если замер свежее
 * (или поле пустое), источник становится `health`; дата рождения и пол
 * пишутся только в пустые поля и ручные значения не перезаписывают.
 */
export function pickBodyMetricUpdates(
  current: CurrentBodyMetrics,
  fromHealth: HealthBodyMetrics,
  now: Date = new Date(),
): BodyMetricUpdates {
  const updates: BodyMetricUpdates = {};

  const weight = pickMeasurement(
    current.weightKg,
    current.weightUpdatedAt ?? current.weightLastChangedAt ?? current.profileUpdatedAt ?? null,
    fromHealth.weightKg,
    fromHealth.weightMeasuredAt,
    WEIGHT_RANGE_KG,
    now,
  );
  if (weight) {
    updates.weightKg = weight.value;
    updates.weightUpdatedAt = weight.updatedAt;
    updates.weightSource = 'health';
  }

  const height = pickMeasurement(
    current.heightCm,
    current.heightUpdatedAt ?? current.heightLastChangedAt ?? current.profileUpdatedAt ?? null,
    fromHealth.heightCm,
    fromHealth.heightMeasuredAt,
    HEIGHT_RANGE_CM,
    now,
  );
  if (height) {
    updates.heightCm = height.value;
    updates.heightUpdatedAt = height.updatedAt;
    updates.heightSource = 'health';
  }

  if (!dateOnly(current.birthDate)) {
    const birthDate = parseBirthDate(fromHealth.birthDate, now);
    if (birthDate) updates.birthDate = birthDate;
  }

  if (!current.gender && fromHealth.sex && SEXES.includes(fromHealth.sex)) {
    updates.gender = fromHealth.sex;
  }

  return updates;
}

/** Поля профиля, которые отдают `GET/PATCH /api/profile` и `POST /api/profile/body-metrics`. */
export const PROFILE_SELECT = {
  id: true,
  email: true,
  username: true,
  isAdmin: true,
  language: true,
  createdAt: true,
  updatedAt: true,
  gender: true,
  birthDate: true,
  weightKg: true,
  weightUpdatedAt: true,
  weightSource: true,
  heightCm: true,
  heightUpdatedAt: true,
  heightSource: true,
  avatarPath: true,
  timeZone: true,
  dailyGoalPoints: true,
  dailyReminderTime: true,
} as const;
