'use client';

import { useCallback, useMemo } from 'react';
import { useAuth } from '@/auth/provider';
import { normalizeFavoriteExercises, resolveFavoriteExercises, type ExerciseType } from '@/lib/exercises';

export function useFavoriteExercises() {
  const { user, setUser } = useAuth();
  const stored = user?.favoriteExercises;
  const favorites = useMemo(() => resolveFavoriteExercises(stored), [stored]);

  const save = useCallback(async (next: ExerciseType[]) => {
    const normalized = normalizeFavoriteExercises(next);
    const previous = user;
    if (user) setUser({ ...user, favoriteExercises: normalized });
    try {
      const res = await fetch('/api/profile/favorite-exercises', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ favoriteExercises: normalized }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      setUser(previous);
      throw error;
    }
  }, [setUser, user]);

  return { favorites, save };
}
