'use client';

import { useEffect, useRef } from 'react';

type AudioContextCtor = typeof AudioContext;

function resolveInteractiveTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest(
    'button:not([disabled]), a[href], summary, [role="button"]:not([aria-disabled="true"]), input[type="button"], input[type="submit"], input[type="reset"], label[for]'
  );
}

export default function TapSound() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const noiseBufferRef = useRef<AudioBuffer | null>(null);
  const lastPlayedAtRef = useRef(0);

  useEffect(() => {
    const handlePointerDown = async (event: PointerEvent) => {
      if (event.defaultPrevented) return;
      if (event.pointerType === 'mouse') return;

      const interactiveTarget = resolveInteractiveTarget(event.target);
      if (!interactiveTarget) return;

      const nowMs = Date.now();
      if (nowMs - lastPlayedAtRef.current < 45) return;
      lastPlayedAtRef.current = nowMs;

      const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
      if (!AudioCtor) return;

      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioCtor();
        }

        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        if (!noiseBufferRef.current) {
          const length = Math.max(1, Math.floor(ctx.sampleRate * 0.028));
          const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let index = 0; index < length; index += 1) {
            const decay = 1 - index / length;
            data[index] = (Math.random() * 2 - 1) * decay;
          }
          noiseBufferRef.current = buffer;
        }

        const startAt = ctx.currentTime;
        const output = ctx.createGain();
        output.gain.setValueAtTime(0.92, startAt);
        output.connect(ctx.destination);

        const sharpClick = ctx.createBufferSource();
        sharpClick.buffer = noiseBufferRef.current;
        const sharpHighpass = ctx.createBiquadFilter();
        sharpHighpass.type = 'highpass';
        sharpHighpass.frequency.setValueAtTime(2400, startAt);
        const sharpLowpass = ctx.createBiquadFilter();
        sharpLowpass.type = 'lowpass';
        sharpLowpass.frequency.setValueAtTime(7600, startAt);
        const sharpGain = ctx.createGain();
        sharpGain.gain.setValueAtTime(0.0001, startAt);
        sharpGain.gain.linearRampToValueAtTime(0.028, startAt + 0.0006);
        sharpGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.008);

        const tailClick = ctx.createBufferSource();
        tailClick.buffer = noiseBufferRef.current;
        const tailBandpass = ctx.createBiquadFilter();
        tailBandpass.type = 'bandpass';
        tailBandpass.frequency.setValueAtTime(1750, startAt + 0.003);
        tailBandpass.Q.setValueAtTime(0.9, startAt + 0.003);
        const tailGain = ctx.createGain();
        tailGain.gain.setValueAtTime(0.0001, startAt);
        tailGain.gain.setValueAtTime(0.0001, startAt + 0.0025);
        tailGain.gain.linearRampToValueAtTime(0.012, startAt + 0.0042);
        tailGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.018);

        sharpClick.connect(sharpHighpass);
        sharpHighpass.connect(sharpLowpass);
        sharpLowpass.connect(sharpGain);
        sharpGain.connect(output);

        tailClick.connect(tailBandpass);
        tailBandpass.connect(tailGain);
        tailGain.connect(output);

        sharpClick.start(startAt);
        tailClick.start(startAt);
        sharpClick.stop(startAt + 0.01);
        tailClick.stop(startAt + 0.02);
      } catch {}
    };

    document.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      const ctx = audioContextRef.current;
      audioContextRef.current = null;
      if (ctx) {
        ctx.close().catch(() => {});
      }
    };
  }, []);

  return null;
}
