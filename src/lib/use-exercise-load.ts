'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { getExercise } from '@/lib/exercises';
import { normalizeLoadKg } from '@/lib/workout-input';

const STORAGE_KEY = 'exerciseLoadKg';
const CHANGE_EVENT = 'exerciseLoadKgChanged';

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
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

// Последний вес снаряда по каждому упражнению: чаще всего человек тренируется с одной
// и той же гирей, и выбирать её заново на каждый подход незачем.
export function useExerciseLoad(exerciseType: string) {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const stored = useMemo(() => parse(raw), [raw]);
  const exercise = getExercise(exerciseType);
  const loadKg = exercise.load ? normalizeLoadKg(stored[exercise.id]) ?? exercise.load.referenceKg : null;

  const setLoadKg = useCallback((next: number) => {
    const value = normalizeLoadKg(next);
    if (value == null) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...parse(readRaw()), [exercise.id]: value }));
    } catch {}
    try {
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch {}
  }, [exercise.id]);

  return { loadKg, setLoadKg };
}
