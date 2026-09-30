'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

type StopwatchState = {
  // Момент последнего запуска (ms); null — секундомер на паузе или не запущен.
  runningSince: number | null;
  // Время, накопленное до последней паузы.
  accumulatedMs: number;
};

const IDLE: StopwatchState = { runningSince: null, accumulatedMs: 0 };

const CHANGE_EVENT = 'stopwatchChanged';

function readRaw(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function parseState(raw: string | null): StopwatchState {
  if (!raw) return IDLE;
  try {
    const parsed = JSON.parse(raw) as Partial<StopwatchState>;
    const runningSince = typeof parsed.runningSince === 'number' ? parsed.runningSince : null;
    const accumulatedMs = typeof parsed.accumulatedMs === 'number' && parsed.accumulatedMs > 0 ? parsed.accumulatedMs : 0;
    return { runningSince, accumulatedMs };
  } catch {
    return IDLE;
  }
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  window.addEventListener('storage', onStoreChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

function writeState(storageKey: string, state: StopwatchState) {
  try {
    if (state.runningSince == null && state.accumulatedMs === 0) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    }
  } catch {}
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {}
}

// Секундомер считает от отметок времени, а не тиками интервала: iOS душит таймеры
// в фоне и при заблокированном экране, а так после возврата время остаётся точным.
// Состояние лежит в localStorage, чтобы перезагрузка страницы не сбрасывала замер.
export function useStopwatch(storageKey: string) {
  const raw = useSyncExternalStore(subscribe, () => readRaw(storageKey), () => null);
  const state = useMemo(() => parseState(raw), [raw]);
  const [now, setNow] = useState(() => Date.now());

  const running = state.runningSince != null;
  const started = running || state.accumulatedMs > 0;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);

  const update = useCallback((next: StopwatchState) => {
    setNow(Date.now());
    writeState(storageKey, next);
  }, [storageKey]);

  const elapsedMs = state.accumulatedMs + (state.runningSince != null ? Math.max(0, now - state.runningSince) : 0);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  const start = useCallback(() => {
    update({ runningSince: Date.now(), accumulatedMs: 0 });
  }, [update]);

  const pause = useCallback(() => {
    if (state.runningSince == null) return;
    update({ runningSince: null, accumulatedMs: state.accumulatedMs + Math.max(0, Date.now() - state.runningSince) });
  }, [state, update]);

  const resume = useCallback(() => {
    if (state.runningSince != null) return;
    update({ runningSince: Date.now(), accumulatedMs: state.accumulatedMs });
  }, [state, update]);

  // Возвращает итоговые секунды на момент вызова и сбрасывает секундомер.
  const finish = useCallback((): number => {
    const total = state.accumulatedMs + (state.runningSince != null ? Math.max(0, Date.now() - state.runningSince) : 0);
    update(IDLE);
    return Math.floor(total / 1000);
  }, [state, update]);

  const reset = useCallback(() => {
    update(IDLE);
  }, [update]);

  return { started, running, elapsedSeconds, start, pause, resume, finish, reset };
}
