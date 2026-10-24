'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/provider';
import { useI18n } from '@/i18n/provider';
import { circuitsMessages } from '@/i18n/messages/features/circuits';
import { BackButton, InfoButton, SubpageStack, useSubpage, type SubpageDef } from '@/components/ui';
import { WorkoutPlayer } from '@/components/workout-player';
import { circuitProgramWizardHref } from '@/lib/app-routes';
import { normalizeTimeZone } from '@/lib/calendar-day';
import {
  CIRCUIT_MAX_CUSTOM,
  CIRCUIT_PLANS,
  CIRCUIT_TEMPLATES,
  getCircuitTemplate,
  type CircuitSpec,
  type CircuitStation,
  type CircuitTemplate,
  type CircuitWarning,
} from '@/lib/circuits';
import { getUserScopedCacheKey, readCachedValue, writeCachedValue } from '@/lib/client-cache';
import { newClientRequestId } from '@/lib/client-request-id';
import { formatExerciseValue } from '@/lib/exercise-metrics';
import { exerciseLabel, isUnilateralExercise } from '@/lib/exercises';
import { syncWorkoutToHealth } from '@/lib/health/health';
import { useOutbox } from '@/lib/offline/use-outbox';
import {
  circuitRunStorageKey,
  circuitRunSteps,
  circuitStationPayload,
  newCircuitRun,
  parseCircuitRun,
  type CircuitRun,
  type PlayerStep,
  type StepResult,
} from '@/lib/workout-player';
import CircuitBuilder, { type CircuitDraft } from './CircuitBuilder';
import styles from './circuits.module.css';

type CustomCircuit = CircuitSpec & { id: string; title: string; warnings: CircuitWarning[] };

type JsonObject = Record<string, unknown>;

async function fetchJson(url: string, init?: RequestInit): Promise<JsonObject | null> {
  const res = await fetch(url, { ...init, credentials: 'include', cache: 'no-store' });
  const body = await res.text();
  let data: JsonObject | null = null;
  if (body) {
    try {
      data = JSON.parse(body) as JsonObject;
    } catch {}
  }
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Ошибка (код ${res.status})`);
  return data;
}

function readRun(userId: string): CircuitRun | null {
  try {
    const raw = window.localStorage.getItem(circuitRunStorageKey(userId));
    return raw ? parseCircuitRun(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeRun(userId: string, run: CircuitRun | null): void {
  try {
    if (run) window.localStorage.setItem(circuitRunStorageKey(userId), JSON.stringify(run));
    else window.localStorage.removeItem(circuitRunStorageKey(userId));
  } catch {}
}

/** Отметка проигрывателя «разминка пройдена» для разового круга. */
function runWarmupKey(runId: string): string {
  return `circuit-run-warmup:v1:${runId}`;
}

function formatKg(kg: number, locale: string): string {
  const v = String(Math.round(kg * 10) / 10);
  return `${locale === 'en' ? v : v.replace('.', ',')} ${locale === 'en' ? 'kg' : 'кг'}`;
}

function stationText(s: CircuitStation, locale: 'ru' | 'en'): string {
  const perSide = isUnilateralExercise(s.exerciseType) ? (locale === 'en' ? '/side' : '/сторона') : '';
  const load = s.loadKg != null ? ` (${formatKg(s.loadKg, locale)})` : '';
  return `${exerciseLabel(s.exerciseType, locale)} ${formatExerciseValue(s.target, s.exerciseType, true, locale)}${perSide}${load}`;
}

const NEW_DRAFT: CircuitDraft = {
  title: '',
  stations: [
    { exerciseType: 'squats', target: 15 },
    { exerciseType: 'pushups', target: 10 },
    { exerciseType: 'crunches', target: 15 },
  ],
  rounds: 3,
  restStationSec: 20,
  restRoundSec: 90,
};

/**
 * Экран «Круговые» (R09, G02, G04): уровни через `?section=` — корень (шаблоны, свои круги,
 * программы-ротации, незаконченный круг), `t.<шаблон>` — состав, `new` / `e.<id>` — конструктор,
 * `run` — проход разового круга. Каждая станция по «Готово» сразу ложится тренировкой в очередь
 * отправки (без связи — ждёт), поэтому брошенный круг оставляет сделанные станции.
 */
export default function CircuitsScreen() {
  const { locale } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const outbox = useOutbox();
  const subpage = useSubpage();
  const text = circuitsMessages[locale];
  const userId = user?.id ?? null;
  const cacheKey = useMemo(() => getUserScopedCacheKey('custom-circuits', user?.id, user?.username), [user?.id, user?.username]);

  const [custom, setCustom] = useState<CustomCircuit[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [run, setRun] = useState<CircuitRun | null>(null);
  const [finished, setFinished] = useState<{ title: string; queued: boolean } | null>(null);
  const [queuedNote, setQueuedNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);

  const loadCustom = useCallback(async () => {
    const cached = readCachedValue<CustomCircuit[]>(cacheKey);
    if (cached) setCustom(cached);
    try {
      const data = await fetchJson('/api/circuits');
      const list = Array.isArray(data?.circuits) ? (data.circuits as CustomCircuit[]) : [];
      setCustom(list);
      setListError(null);
      writeCachedValue(cacheKey, list);
    } catch {
      if (!cached) setListError(text.screen.loadFailed);
    }
  }, [cacheKey, text.screen.loadFailed]);

  useEffect(() => {
    if (!userId) return;
    void loadCustom();
    setRun(readRun(userId));
  }, [loadCustom, userId]);

  const saveRun = useCallback(
    (next: CircuitRun | null) => {
      setRun((prev) => {
        // Брошенный или пройденный круг: его отметка «разминка пройдена» больше не нужна.
        if (prev && prev.runId !== next?.runId) {
          try {
            window.localStorage.removeItem(runWarmupKey(prev.runId));
          } catch {}
        }
        return next;
      });
      if (userId) writeRun(userId, next);
    },
    [userId],
  );

  const startRun = useCallback(
    (title: string, spec: CircuitSpec, source: { templateId?: string; customId?: string }) => {
      if (run && !window.confirm(text.run.replaceConfirm)) return;
      setFinished(null);
      setQueuedNote(false);
      saveRun(newCircuitRun({ runId: newClientRequestId(), title, spec, now: new Date(), ...source }));
      subpage.open('run');
    },
    [run, saveRun, subpage, text.run.replaceConfirm],
  );

  const abandonRun = () => {
    if (!window.confirm(text.run.abandonConfirm)) return;
    saveRun(null);
  };

  /** «Готово» станции: тренировка в очередь отправки (сразу и в Health), отметка в состоянии круга. */
  const onStepDone = useCallback(
    async (step: PlayerStep, result: StepResult) => {
      if (step.kind !== 'exercise' || !run || !userId) return;
      const payload = circuitStationPayload({
        runId: run.runId,
        step,
        result,
        now: new Date(),
        timeZone: normalizeTimeZone(user?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone),
      });
      if (!payload) throw new Error(text.player.invalid);
      const item = await outbox.enqueue(payload);
      void syncWorkoutToHealth(item.payload, userId);
      const next = { ...run, done: run.done.includes(step.id) ? run.done : [...run.done, step.id] };
      saveRun(next);
      void outbox.flush().then((r) => {
        if (r.stopped === 'offline') setQueuedNote(true);
      });
    },
    [outbox, run, saveRun, text.player.invalid, user?.timeZone, userId],
  );

  const onComplete = useCallback(() => {
    if (!run) return;
    setFinished({ title: run.title, queued: queuedNote });
    saveRun(null);
  }, [queuedNote, run, saveRun]);

  const removeCustom = async (c: CustomCircuit) => {
    if (!window.confirm(text.screen.removeConfirm(c.title))) return;
    try {
      await fetchJson(`/api/circuits/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
      await loadCustom();
    } catch (e) {
      setListError(e instanceof Error ? e.message : text.screen.loadFailed);
    }
  };

  const saveCustom = async (id: string | null, draft: CircuitDraft, start: boolean) => {
    setBusy(true);
    setBuilderError(null);
    try {
      const data = await fetchJson(id ? `/api/circuits/${encodeURIComponent(id)}` : '/api/circuits', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const saved = data?.circuit as CustomCircuit | undefined;
      await loadCustom();
      // «Сохранить и начать» — проход открывается поверх конструктора; просто «Сохранить» — назад к списку.
      if (start && saved) startRun(saved.title, saved, { customId: saved.id });
      else subpage.back();
    } catch (e) {
      setBuilderError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runSpec = run?.spec;
  const runSteps = useMemo(() => (runSpec ? circuitRunSteps(runSpec) : []), [runSpec]);
  const runDone = run?.done;
  const runDoneSet = useMemo(() => new Set(runDone ?? []), [runDone]);

  const safetyInfo = (
    <InfoButton title={text.screen.safetyTitle}>
      <p>{text.screen.safety}</p>
      <p>{text.screen.info}</p>
    </InfoButton>
  );

  const templateCard = (t: CircuitTemplate) => (
    <li key={t.id} className={styles.card} data-testid="circuit-template">
      <div className={styles.cardHead}>
        <b className={styles.cardTitle}>{t.title[locale]}</b>
        <span className={`${styles.badge} ${styles[`level_${t.level}`]}`}>{text.screen.level[t.level]}</span>
      </div>
      <div className={styles.muted}>
        {t.equipment.map((e) => text.screen.equipment[e]).join(', ')} · {text.screen.roundsRest(t.rounds, t.restStationSec, t.restRoundSec)}
      </div>
      <div className={styles.stationsLine}>{t.stations.map((s) => stationText(s, locale)).join(' → ')}</div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => startRun(t.title[locale], t, { templateId: t.id })} data-testid="circuit-start">
          {text.screen.start}
        </button>
        <button type="button" className={styles.secondary} onClick={() => subpage.open(`t.${t.id}`)}>
          {text.screen.open}
        </button>
      </div>
    </li>
  );

  const root = (
    <div className={styles.stack} data-testid="circuits-root">
      <div className={styles.headRow}>
        <BackButton fallbackHref="/program" />
        <h1 className={styles.title}>{text.screen.title}</h1>
        {safetyInfo}
      </div>

      {run ? (
        <section className={`${styles.card} ${styles.runCard}`} data-testid="circuit-unfinished">
          <b>{text.run.unfinished}</b>
          <div>{text.run.unfinishedHint(run.title, run.done.length, run.spec.stations.length * run.spec.rounds)}</div>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => subpage.open('run')} data-testid="circuit-continue">
              {text.run.continue}
            </button>
            <button type="button" className={styles.secondary} onClick={abandonRun}>
              {text.run.abandon}
            </button>
          </div>
        </section>
      ) : null}

      <section>
        <h2 className={styles.sectionTitle}>{text.screen.templates}</h2>
        <ul className={styles.list}>{CIRCUIT_TEMPLATES.map(templateCard)}</ul>
      </section>

      <section>
        <div className={styles.labelRow}>
          <h2 className={styles.sectionTitle}>{text.screen.mine}</h2>
        </div>
        {listError ? <p className={styles.error}>{listError}</p> : null}
        {custom.length === 0 && !listError ? <p className={styles.muted}>{text.screen.mineEmpty}</p> : null}
        <ul className={styles.list}>
          {custom.map((c) => (
            <li key={c.id} className={styles.card} data-testid="custom-circuit">
              <div className={styles.cardHead}>
                <b className={styles.cardTitle}>{c.title}</b>
                {c.warnings?.length ? <span className={`${styles.badge} ${styles.badgeWarn}`}>{text.screen.warningsCount(c.warnings.length)}</span> : null}
              </div>
              <div className={styles.muted}>{text.screen.roundsRest(c.rounds, c.restStationSec, c.restRoundSec)}</div>
              <div className={styles.stationsLine}>{c.stations.map((s) => stationText(s, locale)).join(' → ')}</div>
              <div className={styles.actions}>
                <button type="button" className={styles.primary} onClick={() => startRun(c.title, c, { customId: c.id })}>
                  {text.screen.start}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => {
                    setBuilderError(null);
                    subpage.open(`e.${c.id}`);
                  }}
                >
                  {text.screen.edit}
                </button>
                <button type="button" className={styles.danger} onClick={() => void removeCustom(c)}>
                  {text.screen.remove}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => {
            setBuilderError(null);
            subpage.open('new');
          }}
          disabled={custom.length >= CIRCUIT_MAX_CUSTOM}
          data-testid="circuit-new"
        >
          + {text.screen.newCircuit}
        </button>
        {custom.length >= CIRCUIT_MAX_CUSTOM ? <p className={styles.muted}>{text.screen.limit(CIRCUIT_MAX_CUSTOM)}</p> : null}
      </section>

      <section>
        <h2 className={styles.sectionTitle}>{text.screen.programs}</h2>
        <p className={styles.muted}>{text.screen.programsHint}</p>
        <ul className={styles.list}>
          {CIRCUIT_PLANS.map((plan) => (
            <li key={plan.id} className={styles.card} data-testid="circuit-plan">
              <b className={styles.cardTitle}>{plan.title[locale]}</b>
              <div className={styles.muted}>
                {plan.days.map((d) => `${text.program.day(d.label)}: ${getCircuitTemplate(d.templateId)?.title[locale] ?? d.templateId}`).join(' · ')}
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.secondary} onClick={() => router.push(circuitProgramWizardHref(plan.id))}>
                  {text.screen.takeProgram}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );

  const pages: Record<string, SubpageDef> = {};
  for (const t of CIRCUIT_TEMPLATES) {
    pages[`t.${t.id}`] = {
      title: t.title[locale],
      content: () => (
        <div className={styles.stack} data-testid="circuit-template-detail">
          <div className={styles.labelRow}>
            <span className={`${styles.badge} ${styles[`level_${t.level}`]}`}>{text.screen.level[t.level]}</span>
            <span className={styles.muted}>{t.equipment.map((e) => text.screen.equipment[e]).join(', ')}</span>
            {safetyInfo}
          </div>
          <div className={styles.muted}>{text.screen.roundsRest(t.rounds, t.restStationSec, t.restRoundSec)}</div>
          <ol className={styles.detailList}>
            {t.stations.map((s, i) => (
              <li key={i}>{stationText(s, locale)}</li>
            ))}
          </ol>
          <button type="button" className={styles.primary} onClick={() => startRun(t.title[locale], t, { templateId: t.id })}>
            {text.screen.start}
          </button>
        </div>
      ),
    };
  }
  pages.new = {
    title: text.builder.titleNew,
    content: () => (
      <CircuitBuilder initial={NEW_DRAFT} busy={busy} error={builderError} onSave={(d, start) => void saveCustom(null, d, start)} onCancel={subpage.back} />
    ),
  };
  for (const c of custom) {
    pages[`e.${c.id}`] = {
      title: text.builder.titleEdit,
      content: () => (
        <CircuitBuilder
          key={c.id}
          initial={{ title: c.title, stations: c.stations, rounds: c.rounds, restStationSec: c.restStationSec, restRoundSec: c.restRoundSec }}
          busy={busy}
          error={builderError}
          onSave={(d, start) => void saveCustom(c.id, d, start)}
          onCancel={subpage.back}
        />
      ),
    };
  }
  if (run || finished) {
    pages.run = {
      title: run?.title || finished?.title || text.screen.title,
      content: () =>
        run ? (
          <div className={styles.stack}>
            {queuedNote ? <p className={styles.muted}>{text.run.queued}</p> : null}
            <WorkoutPlayer
              key={run.runId}
              steps={runSteps}
              done={runDoneSet}
              resumeKey={runWarmupKey(run.runId)}
              onStepDone={onStepDone}
              onComplete={onComplete}
              info={safetyInfo}
            />
          </div>
        ) : finished ? (
          <section className={styles.card} data-testid="circuit-finished">
            <b className={styles.cardTitle}>{text.run.finishedTitle}</b>
            <p>{text.run.finishedHint}</p>
            {finished.queued ? <p className={styles.muted}>{text.run.queued}</p> : null}
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={subpage.back}>
                {text.run.toCircuits}
              </button>
              <button type="button" className={styles.secondary} onClick={() => router.push('/dashboard')}>
                {text.run.toDashboard}
              </button>
            </div>
          </section>
        ) : null,
    };
  }

  return <SubpageStack root={root} pages={pages} className={styles.screen} />;
}
