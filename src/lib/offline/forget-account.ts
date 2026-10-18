/**
 * The account was deleted on this device (story 56): everything of it goes from the phone, as on
 * sign-out with «sign out and delete» — the native background copies of its queue (they must not
 * go out), the queue itself, the session token, the data caches, its Health switch. Records already
 * in Health stay (they are the person's health data). Each step is independent: a failing one does
 * not keep the others from running.
 */

import { clearClientDataCaches } from '@/lib/client-cache';
import { forgetHealthUser } from '@/lib/health/health';
import { clearToken } from '@/lib/native-auth';
import { cancelAllBackground } from './background-upload';
import { outboxStore } from './outbox-store';

export async function forgetAccountOnDevice(userId: string | null | undefined): Promise<void> {
  const steps: Array<() => unknown> = [
    () => cancelAllBackground(),
    () => (userId ? outboxStore.clear(userId) : undefined),
    () => clearToken(),
    () => clearClientDataCaches(),
    () => navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_RUNTIME_CACHES' }),
    () => (userId ? forgetHealthUser(userId) : undefined),
  ];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      console.error('forget account on device: a step failed', error);
    }
  }
}
