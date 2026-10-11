'use client';

import type { ShareCard } from '@/lib/share-card';

/** Square: fits chat previews and feeds without cropping. */
export const SHARE_CARD_SIZE = 1080;

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const PAD = 84;
const APP_NAME = 'Pushup Tracker';
const ICON_SRC = '/icons/icon-192.png';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Largest font size (≤ max) at which `text` fits into `width`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, max: number, min: number, width: number): number {
  for (let size = max; size > min; size -= 4) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= width) return size;
  }
  return min;
}

/** Splits `text` into at most `maxLines` lines of `width`; the last one gets «…» if it still overflows. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`;
  while (last.length > 1 && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws the card on a fresh canvas and returns it as PNG. */
export async function renderShareCard(card: ShareCard, link: string, cta: string): Promise<Blob> {
  const size = SHARE_CARD_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');

  const icon = await loadImage(ICON_SRC);
  if (typeof document.fonts?.ready?.then === 'function') await document.fonts.ready;

  // Background: dark navy with a glow in the card's accent colour.
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#0f172a');
  bg.addColorStop(1, '#1e293b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  const glow = ctx.createRadialGradient(size * 0.82, size * 0.12, 0, size * 0.82, size * 0.12, size * 0.75);
  glow.addColorStop(0, `${card.accent}cc`);
  glow.addColorStop(1, `${card.accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // Header: app icon + name.
  const iconSize = 84;
  if (icon) {
    ctx.save();
    roundRect(ctx, PAD, PAD, iconSize, iconSize, 22);
    ctx.clip();
    ctx.drawImage(icon, PAD, PAD, iconSize, iconSize);
    ctx.restore();
  }
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `800 46px ${FONT}`;
  ctx.fillText(APP_NAME, icon ? PAD + iconSize + 24 : PAD, PAD + iconSize / 2);

  // Emoji.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `150px ${EMOJI_FONT}`;
  ctx.fillText(card.emoji, size / 2, 400);

  // Eyebrow pill.
  ctx.font = `800 40px ${FONT}`;
  const eyebrow = card.eyebrow.toUpperCase();
  const pillW = Math.min(size - PAD * 2, ctx.measureText(eyebrow).width + 64);
  const pillH = 70;
  const pillY = 450;
  ctx.fillStyle = card.accent;
  roundRect(ctx, (size - pillW) / 2, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(eyebrow, size / 2, pillY + pillH / 2 + 2, size - PAD * 2 - 64);

  // Headline: as big as fits.
  const headSize = fitFont(ctx, card.headline, 900, 210, 72, size - PAD * 2);
  ctx.font = `900 ${headSize}px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  const headBase = 600 + headSize * 0.78;
  ctx.fillText(card.headline, size / 2, headBase);

  // Caption: up to two lines.
  ctx.font = `600 48px ${FONT}`;
  ctx.fillStyle = '#cbd5e1';
  wrapLines(ctx, card.caption, size - PAD * 2, 2).forEach((line, i) => {
    ctx.fillText(line, size / 2, headBase + 84 + i * 60);
  });

  // Footer: call to action + link.
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, size - 190);
  ctx.lineTo(size - PAD, size - 190);
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 42px ${FONT}`;
  ctx.fillText(`${cta} →`, PAD, size - 120, size - PAD * 2);
  ctx.fillStyle = '#94a3b8';
  ctx.font = `500 34px ${FONT}`;
  ctx.fillText(link, PAD, size - 68, size - PAD * 2);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
