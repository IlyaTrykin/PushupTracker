'use client';

import { useState } from 'react';
import ExerciseFavoritesSheet from '@/components/ExerciseFavoritesSheet';
import { InfoButton, MenuList, MenuRow } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { dailyGoalMessages } from '@/i18n/messages/features/daily-goal';
import { fillProfileText, profileSectionsMessages } from '@/i18n/messages/features/profile-sections';
import { DAILY_GOAL_MAX_POINTS, DAILY_GOAL_MIN_POINTS, DEFAULT_REMINDER_TIME } from '@/lib/daily-goal';
import { FAVORITE_EXERCISE_LIMIT } from '@/lib/exercises';
import { useFavoriteExercises } from '@/lib/use-favorite-exercises';
import type { Profile } from './sections';
import { buttonPrimary, errorBox, fieldInput, fieldLabel, okText, panelCard, sectionTitle, titleRow } from './profile-styles';

/**
 * «Тренировки»: цель дня с временем напоминания (якорь `#daily-goal` — сюда) и «Мои упражнения»
 * (лист выбора закреплённых упражнений, раньше был в боковом меню).
 */
export default function TrainingSection({ profile, reload }: { profile: Profile; reload: () => Promise<void> }) {
  const { locale, messages } = useI18n();
  const goalText = dailyGoalMessages[locale];
  const text = profileSectionsMessages[locale].training;
  const { favorites } = useFavoriteExercises();
  const [dailyGoal, setDailyGoal] = useState(profile.dailyGoalPoints != null ? String(profile.dailyGoalPoints) : '');
  const [reminderTime, setReminderTime] = useState(profile.dailyReminderTime || DEFAULT_REMINDER_TIME);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [favoritesOpen, setFavoritesOpen] = useState(false);

  // Профиль пришёл заново (кэш → сервер): нетронутые поля следуют за ним.
  const [base, setBase] = useState(profile);
  if (base !== profile) {
    setBase(profile);
    const goalBefore = base.dailyGoalPoints != null ? String(base.dailyGoalPoints) : '';
    if (dailyGoal === goalBefore) setDailyGoal(profile.dailyGoalPoints != null ? String(profile.dailyGoalPoints) : '');
    if (reminderTime === (base.dailyReminderTime || DEFAULT_REMINDER_TIME)) setReminderTime(profile.dailyReminderTime || DEFAULT_REMINDER_TIME);
  }

  async function saveDailyGoal() {
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dailyGoalPoints: dailyGoal.trim() === '' ? null : Number(dailyGoal),
          dailyReminderTime: reminderTime || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || messages.profile.errors.save);
        return;
      }
      setSaved(true);
      await reload();
    } catch {
      setError(messages.profile.errors.network);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section id="daily-goal" style={{ ...panelCard, scrollMarginTop: 80 }}>
        <div style={{ ...sectionTitle, ...titleRow }}>
          {goalText.sectionTitle}
          <InfoButton title={goalText.sectionTitle}>{goalText.sectionHint}</InfoButton>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ ...fieldLabel, ...titleRow }}>
              {goalText.goalLabel}
              <InfoButton title={goalText.goalLabel}>{goalText.goalHint}</InfoButton>
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={DAILY_GOAL_MIN_POINTS}
              max={DAILY_GOAL_MAX_POINTS}
              step={1}
              placeholder={goalText.goalPlaceholder}
              value={dailyGoal}
              onChange={(e) => {
                setDailyGoal(e.target.value);
                setSaved(false);
              }}
              style={fieldInput}
              data-testid="daily-goal-input"
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={fieldLabel}>{goalText.reminderLabel}</span>
            <input
              type="time"
              value={reminderTime}
              onChange={(e) => {
                setReminderTime(e.target.value);
                setSaved(false);
              }}
              style={fieldInput}
            />
          </label>
          {error ? (
            <div style={errorBox} role="alert">
              {error}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => void saveDailyGoal()}
              disabled={saving}
              style={{ ...buttonPrimary, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? messages.common.saving : goalText.save}
            </button>
            {saved ? (
              <span style={okText} role="status">
                {goalText.saved}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <MenuList label={text.myExercises}>
        <MenuRow
          label={text.myExercises}
          value={fillProfileText(text.myExercisesValue, { count: favorites.length, limit: FAVORITE_EXERCISE_LIMIT })}
          onClick={() => setFavoritesOpen(true)}
          testId="profile-my-exercises"
        />
      </MenuList>
      <ExerciseFavoritesSheet open={favoritesOpen} onClose={() => setFavoritesOpen(false)} />
    </div>
  );
}
