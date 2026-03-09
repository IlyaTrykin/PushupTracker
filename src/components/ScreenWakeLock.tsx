'use client';

import { useCallback, useEffect, useRef } from 'react';

type WakeLockSentinelLike = {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
};

export default function ScreenWakeLock() {
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  const releaseWakeLock = useCallback(async () => {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    if (!sentinel) return;
    try {
      await sentinel.release();
    } catch {}
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState !== 'visible') return;

    const wakeLockApi = (navigator as any)?.wakeLock;
    if (!wakeLockApi?.request) return;
    if (wakeLockRef.current && !wakeLockRef.current.released) return;

    try {
      const sentinel = await wakeLockApi.request('screen');
      wakeLockRef.current = sentinel;
      sentinel?.addEventListener?.('release', () => {
        if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
      });
    } catch {}
  }, []);

  useEffect(() => {
    requestWakeLock();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      } else {
        releaseWakeLock();
      }
    };

    const onResume = () => {
      requestWakeLock();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onResume);
    window.addEventListener('pageshow', onResume);
    window.addEventListener('pointerdown', onResume);
    window.addEventListener('keydown', onResume);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('pageshow', onResume);
      window.removeEventListener('pointerdown', onResume);
      window.removeEventListener('keydown', onResume);
      releaseWakeLock();
    };
  }, [requestWakeLock, releaseWakeLock]);

  return null;
}
