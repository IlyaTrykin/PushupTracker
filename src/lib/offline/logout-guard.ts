'use client';

/**
 * Sign-out with unsent workouts (story 21): first try to send them; if some are still on the
 * device, ask «sign out and delete» / «stay». The sign-out button calls `checkBeforeLogout()`
 * and goes on only on `'proceed'`; the queue is then already cleared for this user.
 */

import { useCallback } from 'react';
import { useAuth } from '@/auth/provider';
import { useI18n } from '@/i18n/provider';
import { offlineOutboxMessages } from '@/i18n/messages/features/offline-outbox';
import type { OutboxItem } from './outbox-core';
import { outboxStore } from './outbox-store';
import { flushOutbox, type FlushDeps } from './sync';

export type LogoutDecision = 'proceed' | 'stay';

/** Workouts not on the server yet; entries «будет удалена» are not workouts to lose. */
function unsentWorkouts(items: OutboxItem[]): OutboxItem[] {
  return items.filter((item) => !item.deleteOnServer);
}

/**
 * `ask(count)` resolves true for «sign out and delete». Entries «будет удалена» are neither counted
 * nor deleted: they stay on the device under their user and go to the server at the next sign-in of
 * the same user (otherwise a workout the user deleted would stay on the server).
 */
export async function confirmLogoutWithOutbox(
  userId: string,
  ask: (unsentCount: number) => boolean | Promise<boolean>,
  deps: FlushDeps = {},
): Promise<LogoutDecision> {
  let items = await outboxStore.list(userId);
  if (!items.length) return 'proceed';
  await flushOutbox(userId, { ...deps, ignoreBackoff: true });
  items = unsentWorkouts(await outboxStore.list(userId));
  if (!items.length) return 'proceed';
  if (!(await ask(items.length))) return 'stay';
  for (const item of items) await outboxStore.remove(item.id);
  return 'proceed';
}

/** For the sign-out button; without `ask` a plain confirm dialog with the localized text. */
export function useOutboxLogoutGuard(ask?: (unsentCount: number) => boolean | Promise<boolean>) {
  const { user } = useAuth();
  const { locale } = useI18n();
  const userId = user?.id ?? null;
  const checkBeforeLogout = useCallback(async (): Promise<LogoutDecision> => {
    if (!userId) return 'proceed';
    try {
      return await confirmLogoutWithOutbox(
        userId,
        ask ?? ((count) => window.confirm(offlineOutboxMessages[locale].logoutConfirm.replace('{count}', String(count)))),
      );
    } catch (error) {
      console.error('outbox: check before sign-out failed', error);
      return 'proceed';
    }
  }, [ask, locale, userId]);
  return { checkBeforeLogout };
}
