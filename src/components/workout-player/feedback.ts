'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { getLocaleTimerAudio, type Locale } from '@/i18n/locale';

/**
 * Звук, вибрация и «не гасить экран» для таймеров занятия (перенесено со страницы занятия
 * программы): голос «приготовьтесь» за 5 с и «старт» в ноль (`getLocaleTimerAudio`), короткий
 * сигнал на последних секундах (`playCountdownBeep`), карточка таймера в MediaSession, wakeLock.
 */

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request?: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

type WindowWithWebkitAudioContext = Window & { webkitAudioContext?: typeof AudioContext };

/**
 * Вибрация конца таймера. `@capacitor/haptics` в проекте нет, поэтому и в приложении —
 * `navigator.vibrate` (Android WebView; в iOS WebView API нет — тогда только звук).
 */
export function vibrate(pattern: number | number[] = [180, 90, 180]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {}
}

export function useTimerSound(locale: Locale, media: { title: string; artist: string; album: string }) {
  const timerAudio = useMemo(() => getLocaleTimerAudio(locale), [locale]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const prepareAudioRef = useRef<HTMLAudioElement | null>(null);
  const startAudioRef = useRef<HTMLAudioElement | null>(null);

  const clip = useCallback((ref: { current: HTMLAudioElement | null }, src: string) => {
    if (!ref.current) {
      ref.current = new Audio(src);
      ref.current.preload = 'auto';
      ref.current.dataset.clipSrc = src;
    } else if (ref.current.dataset.clipSrc !== src) {
      ref.current.pause();
      ref.current.src = src;
      ref.current.load();
      ref.current.dataset.clipSrc = src;
    }
    return ref.current;
  }, []);

  const getAudioElements = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const prepare = clip(prepareAudioRef, timerAudio.prepare);
    const start = clip(startAudioRef, timerAudio.start);
    const mediaSession = navigator.mediaSession;
    const MediaMetadataCtor = window.MediaMetadata;
    if (mediaSession && MediaMetadataCtor) {
      mediaSession.metadata = new MediaMetadataCtor({
        title: media.title,
        artist: media.artist,
        album: media.album,
        artwork: [
          { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
    }
    return { prepare, start };
  }, [clip, media.album, media.artist, media.title, timerAudio.prepare, timerAudio.start]);

  /** Разблокировать звук жестом человека (кнопка «Начать», «Готово», «Пауза»). */
  const prime = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const AudioCtor = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
    if (AudioCtor) {
      if (!audioContextRef.current) audioContextRef.current = new AudioCtor();
      if (audioContextRef.current.state === 'suspended') {
        try {
          await audioContextRef.current.resume();
        } catch {}
      }
    }
    const audio = getAudioElements();
    if (!audio) return;
    await Promise.all(
      Object.values(audio).map(async (el) => {
        try {
          el.muted = true;
          el.currentTime = 0;
          await el.play();
          el.pause();
          el.currentTime = 0;
          el.muted = false;
        } catch {}
      }),
    );
  }, [getAudioElements]);

  const beep = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx || ctx.state !== 'running') return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 920;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.15);
  }, []);

  const voice = useCallback(
    (kind: 'prepare' | 'start') => {
      const audio = getAudioElements()?.[kind];
      if (!audio) return;
      try {
        audio.pause();
        audio.currentTime = 0;
        void audio.play().catch(() => {});
      } catch {}
    },
    [getAudioElements],
  );

  useEffect(
    () => () => {
      prepareAudioRef.current?.pause();
      startAudioRef.current?.pause();
      audioContextRef.current?.close().catch(() => {});
    },
    [],
  );

  return { prime, beep, voice };
}

/** Не гасить экран, пока идёт таймер (`active`); отпускается при уходе со вкладки и размонтировании. */
export function useScreenWakeLock(active: boolean): void {
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  const release = useCallback(async () => {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    if (!sentinel) return;
    try {
      await sentinel.release();
    } catch {}
  }, []);

  const request = useCallback(async () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible' || wakeLockRef.current) return;
    const api = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!api?.request) return;
    try {
      const sentinel = await api.request('screen');
      wakeLockRef.current = sentinel;
      sentinel?.addEventListener?.('release', () => {
        if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
      });
    } catch {}
  }, []);

  useEffect(() => {
    if (active) void request();
    else void release();
    const onVisibility = () => {
      if (active && document.visibilityState === 'visible') void request();
      else void release();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [active, request, release]);

  useEffect(() => () => void release(), [release]);
}
