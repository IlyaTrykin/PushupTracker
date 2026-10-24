/**
 * Разделы профиля (R14) — уровни `?section=<id>` (`useSubpage` / `SubpageStack`). Ид разделов —
 * часть адресов: `/profile?section=personal` уже открывают «Здоровье» и приглашение указать вес.
 */
export const PROFILE_SECTIONS = ['personal', 'training', 'health', 'notifications', 'security', 'docs', 'account'] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/**
 * Старые адреса профиля с якорем → раздел (R14.1): «Поставить цель» на дашборде ведёт на
 * `/profile#daily-goal`, а цель дня теперь в «Тренировках».
 */
export const LEGACY_HASH_SECTIONS: Readonly<Record<string, ProfileSection>> = {
  '#daily-goal': 'training',
};

export function profileSectionHref(section: ProfileSection): string {
  return `/profile?section=${section}`;
}

/** Профиль, в котором работают разделы (ответ `GET /api/profile`). */
export type Profile = {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
  language: string;
  createdAt: string;
  updatedAt: string;
  gender: string | null;
  birthDate: string | null;
  weightKg: number | null;
  weightSource?: string | null;
  heightCm?: number | null;
  heightSource?: string | null;
  avatarPath: string | null;
  timeZone?: string;
  dailyGoalPoints?: number | null;
  dailyReminderTime?: string | null;
};
