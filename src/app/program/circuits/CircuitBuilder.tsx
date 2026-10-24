'use client';

import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { circuitsMessages } from '@/i18n/messages/features/circuits';
import { InfoButton } from '@/components/ui';
import {
  CIRCUIT_MAX_STATIONS,
  CIRCUIT_REST_ROUND_RANGE,
  CIRCUIT_REST_STATION_RANGE,
  CIRCUIT_ROUNDS_RANGE,
  CIRCUIT_TITLE_MAX,
  circuitTargetRange,
  isCircuitExercise,
  validateCircuit,
  type CircuitSpec,
  type CircuitStation,
} from '@/lib/circuits';
import { EXERCISES, EXERCISE_IDS, exerciseLabel, isUnilateralExercise, type ExerciseType } from '@/lib/exercises';
import styles from './circuits.module.css';

/** Упражнения конструктора: весь каталог без исключённых (выходы силой, толчок гири). */
const BUILDER_EXERCISES: readonly ExerciseType[] = EXERCISE_IDS.filter((id) => isCircuitExercise(id));

export type CircuitDraft = CircuitSpec & { title: string };

type StationDraft = { exerciseType: ExerciseType; target: string; loadKg: number | null };

function defaultTarget(type: ExerciseType): number {
  const unit = EXERCISES[type].unit;
  if (unit === 'distance') return 400;
  if (unit === 'seconds') return 30;
  return 10;
}

function toDraft(station: CircuitStation): StationDraft {
  return { exerciseType: station.exerciseType, target: String(station.target), loadKg: station.loadKg ?? null };
}

function intOr(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/**
 * Конструктор своего круга (R09.2, G02): станции с упражнением, целью и гирей, круги, отдых.
 * Предупреждения `validateCircuit` — у станции и сводкой; сохранить можно и с ними.
 * Проверку границ и исключённых упражнений повторяет сервер (`parseCustomCircuitInput`).
 */
export default function CircuitBuilder({
  initial,
  busy,
  error,
  onSave,
  onCancel,
}: {
  initial: CircuitDraft;
  busy: boolean;
  error: string | null;
  onSave(draft: CircuitDraft, start: boolean): void;
  onCancel(): void;
}) {
  const { locale } = useI18n();
  const text = circuitsMessages[locale].builder;
  const [title, setTitle] = useState(initial.title);
  const [stations, setStations] = useState<StationDraft[]>(() => initial.stations.map(toDraft));
  const [rounds, setRounds] = useState(String(initial.rounds));
  const [restStation, setRestStation] = useState(String(initial.restStationSec));
  const [restRound, setRestRound] = useState(String(initial.restRoundSec));

  const spec: CircuitDraft = useMemo(
    () => ({
      title: title.trim(),
      stations: stations.map((s) => {
        const station: CircuitStation = { exerciseType: s.exerciseType, target: intOr(s.target, 0) };
        if (EXERCISES[s.exerciseType].load) station.loadKg = s.loadKg ?? EXERCISES[s.exerciseType].load?.referenceKg ?? null;
        return station;
      }),
      rounds: intOr(rounds, 0),
      restStationSec: intOr(restStation, -1),
      restRoundSec: intOr(restRound, -1),
    }),
    [restRound, restStation, rounds, stations, title],
  );
  const warnings = useMemo(() => validateCircuit(spec), [spec]);

  const update = (i: number, patch: Partial<StationDraft>) =>
    setStations((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, delta: number) =>
    setStations((prev) => {
      const j = i + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const valid =
    spec.title.length > 0 &&
    spec.title.length <= CIRCUIT_TITLE_MAX &&
    spec.stations.length > 0 &&
    spec.stations.every((s) => {
      const range = circuitTargetRange(s.exerciseType);
      return s.target >= range.min && s.target <= range.max;
    }) &&
    spec.rounds >= CIRCUIT_ROUNDS_RANGE.min &&
    spec.rounds <= CIRCUIT_ROUNDS_RANGE.max &&
    spec.restStationSec >= CIRCUIT_REST_STATION_RANGE.min &&
    spec.restStationSec <= CIRCUIT_REST_STATION_RANGE.max &&
    spec.restRoundSec >= CIRCUIT_REST_ROUND_RANGE.min &&
    spec.restRoundSec <= CIRCUIT_REST_ROUND_RANGE.max;

  return (
    <div className={styles.stack} data-testid="circuit-builder">
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{text.name}</span>
        <input
          className={styles.input}
          value={title}
          maxLength={CIRCUIT_TITLE_MAX}
          placeholder={text.namePlaceholder}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="builder-title"
        />
      </label>

      <div className={styles.labelRow}>
        <h3 className={styles.sectionTitle}>{text.stations}</h3>
        <InfoButton title={text.stations}>{text.excludedInfo}</InfoButton>
      </div>

      <ol className={styles.stationList}>
        {stations.map((s, i) => {
          const range = circuitTargetRange(s.exerciseType);
          const load = EXERCISES[s.exerciseType].load;
          const stationWarnings = warnings.filter((w) => w.stationIndex === i);
          return (
            <li key={i} className={`${styles.stationCard} ${stationWarnings.length ? styles.stationWarn : ''}`} data-testid="builder-station">
              <div className={styles.stationHead}>
                <b>{text.station(i + 1)}</b>
                <div className={styles.stationTools}>
                  <button type="button" className={styles.tool} onClick={() => move(i, -1)} disabled={i === 0} aria-label={text.moveUp}>
                    ↑
                  </button>
                  <button type="button" className={styles.tool} onClick={() => move(i, 1)} disabled={i === stations.length - 1} aria-label={text.moveDown}>
                    ↓
                  </button>
                  <button
                    type="button"
                    className={styles.tool}
                    onClick={() => setStations((prev) => prev.filter((_, j) => j !== i))}
                    disabled={stations.length <= 1}
                  >
                    {text.removeStation}
                  </button>
                </div>
              </div>
              <div className={styles.stationFields}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>{text.exercise}</span>
                  <select
                    className={styles.input}
                    value={s.exerciseType}
                    onChange={(e) => {
                      const type = e.target.value as ExerciseType;
                      update(i, { exerciseType: type, target: String(defaultTarget(type)), loadKg: EXERCISES[type].load?.referenceKg ?? null });
                    }}
                    data-testid="builder-exercise"
                  >
                    {BUILDER_EXERCISES.map((type) => (
                      <option key={type} value={type}>
                        {exerciseLabel(type, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    {isUnilateralExercise(s.exerciseType) ? text.targetPerSide : text.target}
                    {EXERCISES[s.exerciseType].unit === 'seconds' ? (locale === 'en' ? ', s' : ', с') : EXERCISES[s.exerciseType].unit === 'distance' ? (locale === 'en' ? ', m' : ', м') : ''}
                  </span>
                  <input
                    className={styles.input}
                    type="number"
                    inputMode="numeric"
                    min={range.min}
                    max={range.max}
                    value={s.target}
                    onChange={(e) => update(i, { target: e.target.value })}
                    data-testid="builder-target"
                  />
                </label>
                {load ? (
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>{text.loadKg}</span>
                    <select
                      className={styles.input}
                      value={s.loadKg ?? load.referenceKg}
                      onChange={(e) => update(i, { loadKg: Number(e.target.value) || null })}
                    >
                      {load.presetsKg.map((kg) => (
                        <option key={kg} value={kg}>
                          {kg}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              {stationWarnings.map((w) => (
                <p key={`${w.code}-${w.rule}`} className={styles.warning} data-testid="builder-warning">
                  ⚠ {text.warnings[w.code]}
                </p>
              ))}
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        className={styles.secondary}
        onClick={() => setStations((prev) => [...prev, { exerciseType: 'squats', target: String(defaultTarget('squats')), loadKg: null }])}
        disabled={stations.length >= CIRCUIT_MAX_STATIONS}
        data-testid="builder-add"
      >
        + {text.addStation}
      </button>
      {stations.length >= CIRCUIT_MAX_STATIONS ? <p className={styles.muted}>{text.maxStations(CIRCUIT_MAX_STATIONS)}</p> : null}

      <div className={styles.grid3}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{text.rounds}</span>
          <input className={styles.input} type="number" min={CIRCUIT_ROUNDS_RANGE.min} max={CIRCUIT_ROUNDS_RANGE.max} value={rounds} onChange={(e) => setRounds(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{text.restStation}</span>
          <input className={styles.input} type="number" min={CIRCUIT_REST_STATION_RANGE.min} max={CIRCUIT_REST_STATION_RANGE.max} value={restStation} onChange={(e) => setRestStation(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{text.restRound}</span>
          <input className={styles.input} type="number" min={CIRCUIT_REST_ROUND_RANGE.min} max={CIRCUIT_REST_ROUND_RANGE.max} value={restRound} onChange={(e) => setRestRound(e.target.value)} />
        </label>
      </div>

      {warnings.length ? (
        <div className={styles.warnBox} role="status" data-testid="builder-warnings">
          <b>
            {text.warningsTitle}: {warnings.length}
          </b>
          <ul>
            {warnings.map((w, k) => (
              <li key={k}>
                {text.station(w.stationIndex + 1)}: {text.warnings[w.code]}
              </li>
            ))}
          </ul>
          <div>{text.warningsNote}</div>
        </div>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => onSave(spec, false)} disabled={!valid || busy} data-testid="builder-save">
          {busy ? text.saving : text.save}
        </button>
        <button type="button" className={styles.secondary} onClick={() => onSave(spec, true)} disabled={!valid || busy} data-testid="builder-save-start">
          {text.saveAndStart}
        </button>
        <button type="button" className={styles.secondary} onClick={onCancel} disabled={busy}>
          {text.cancel}
        </button>
      </div>
    </div>
  );
}
