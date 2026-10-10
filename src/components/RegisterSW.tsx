'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/auth/provider';

/** Build version baked in by next.config.ts — versions the SW script URL (B18). */
const SW_URL = `/sw.js?v=${encodeURIComponent(process.env.NEXT_PUBLIC_BUILD_VERSION || 'dev')}`;

const PUSH_WANTED_KEY_PREFIX = 'pushup-push-wanted:';
const RELOAD_GUARD_KEY = 'pushup-sw-reload-at';
const RELOAD_GUARD_MS = 30_000;

export function base64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/** Remembers in this browser whether the user wants push ('1') or switched it off ('0'). */
export function setPushWanted(userId: string | undefined, wanted: boolean) {
  if (!userId) return;
  try {
    localStorage.setItem(PUSH_WANTED_KEY_PREFIX + userId, wanted ? '1' : '0');
  } catch {
    // нет хранилища — переподписка просто опирается на сервер
  }
}

function readPushWanted(userId: string): '1' | '0' | null {
  try {
    const value = localStorage.getItem(PUSH_WANTED_KEY_PREFIX + userId);
    return value === '1' || value === '0' ? value : null;
  } catch {
    return null;
  }
}

async function postSubscription(subscription: PushSubscription) {
  await fetch('/api/push/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(subscription.toJSON()),
  });
}

/**
 * Silent push recovery (B01): permission is granted and the user had push on, but the
 * browser has no subscription (SW was unregistered, subscription expired) — subscribe
 * again and tell the server. Never prompts.
 */
async function restorePushSubscription(userId: string) {
  if (!('Notification' in window) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;

  const wanted = readPushWanted(userId);
  if (wanted === '0') return;

  const statusRes = await fetch('/api/push/subscriptions', { cache: 'no-store', credentials: 'include' });
  if (!statusRes.ok) return;
  const status = (await statusRes.json().catch(() => ({}))) as { enabled?: boolean; configured?: boolean };
  if (status.configured === false) return;

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    // Подписка в браузере есть, а сервер её забыл — вернуть.
    if (wanted === '1' && !status.enabled) await postSubscription(existing);
    return;
  }

  if (wanted !== '1' && !status.enabled) return;

  const keyRes = await fetch('/api/push/public-key', { cache: 'no-store' });
  const keyData = (await keyRes.json().catch(() => ({}))) as { enabled?: boolean; publicKey?: string };
  if (!keyData.enabled || !keyData.publicKey) return;

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64ToUint8Array(keyData.publicKey),
  });
  await postSubscription(subscription);
  setPushWanted(userId, true);
}

export default function RegisterSW() {
  const { user } = useAuth();
  const userId = user?.id;
  const restoredForUser = useRef<string | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let intervalId: number | undefined;
    let reloaded = false;
    // Перезагружаемся только при смене уже работавшего SW (новая версия после деплоя);
    // первая установка (controller ещё нет) страницу не перезагружает.
    const hadController = Boolean(navigator.serviceWorker.controller);

    const reload = () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      // Предохранитель от цикла: не чаще одной перезагрузки за 30 с на вкладку.
      try {
        const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
        if (Date.now() - last < RELOAD_GUARD_MS) return;
        sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
      } catch {
        return;
      }
      window.location.reload();
    };

    const register = async () => {
      try {
        navigator.serviceWorker.addEventListener('controllerchange', reload);

        const reg = await navigator.serviceWorker.register(SW_URL);

        // Если есть waiting — просим активироваться сразу
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        // При появлении новой версии — тоже активируем сразу
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;

          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed') {
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        // Периодически проверяем обновления SW
        intervalId = window.setInterval(() => reg.update(), 60 * 60 * 1000);
      } catch {
        // игнорируем
      }
    };

    // Гидратация могла случиться уже после 'load' — тогда регистрируем сразу.
    if (document.readyState === 'complete') {
      void register();
    } else {
      window.addEventListener('load', register, { once: true });
    }

    return () => {
      window.removeEventListener('load', register);
      navigator.serviceWorker.removeEventListener('controllerchange', reload);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!userId || !('serviceWorker' in navigator)) return;
    if (restoredForUser.current === userId) return;
    restoredForUser.current = userId;
    restorePushSubscription(userId).catch(() => {
      // тихо: при ошибке пользователь всегда может включить push вручную
    });
  }, [userId]);

  return null;
}
