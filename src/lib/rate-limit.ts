/**
 * Fixed-window rate limits stored in Postgres (`RateLimitBucket`), so they
 * survive restarts. Every attempt counts, including rejected ones.
 */

import crypto from 'crypto';
import { NextResponse } from 'next/server';

export type RateLimitBucketState = { windowStart: Date; count: number };

export type RateLimitDecision = {
  bucket: RateLimitBucketState;
  ok: boolean;
  retryAfterSeconds: number;
};

const MAX_KEY_LENGTH = 200;

/** One attempt against a bucket: the next bucket state and whether the attempt is allowed. */
export function applyRateLimitWindow(
  bucket: RateLimitBucketState | null,
  now: Date,
  limit: number,
  windowSeconds: number,
): RateLimitDecision {
  const windowMs = windowSeconds * 1000;
  const expired = !bucket || now.getTime() - bucket.windowStart.getTime() >= windowMs;
  const next: RateLimitBucketState = expired
    ? { windowStart: now, count: 1 }
    : { windowStart: bucket.windowStart, count: bucket.count + 1 };

  if (next.count <= limit) return { bucket: next, ok: true, retryAfterSeconds: 0 };

  const leftMs = next.windowStart.getTime() + windowMs - now.getTime();
  return { bucket: next, ok: false, retryAfterSeconds: Math.max(1, Math.ceil(leftMs / 1000)) };
}

function storageKey(key: string): string {
  if (key.length <= MAX_KEY_LENGTH) return key;
  return `sha256:${crypto.createHash('sha256').update(key).digest('hex')}`;
}

/**
 * Counts an attempt for `key` and tells whether it fits into `limit` per `windowSeconds`.
 * Atomic under concurrency: the bucket row is locked for the read-modify-write.
 */
export async function hitRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  const { prisma } = await import('./prisma');
  const id = storageKey(key);

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.rateLimitBucket.createMany({
      data: [{ key: id, windowStart: new Date(0), count: 0 }],
      skipDuplicates: true,
    });
    const rows = await tx.$queryRaw<RateLimitBucketState[]>`
      SELECT "windowStart", "count" FROM "RateLimitBucket" WHERE "key" = ${id} FOR UPDATE
    `;
    const decision = applyRateLimitWindow(rows[0] ?? null, now, limit, windowSeconds);
    await tx.rateLimitBucket.update({
      where: { key: id },
      data: { windowStart: decision.bucket.windowStart, count: decision.bucket.count },
    });
    return { ok: decision.ok, retryAfterSeconds: decision.retryAfterSeconds };
  });
}

/** The client address as reported by the reverse proxy (first X-Forwarded-For entry). */
export function clientIp(request: Request): string {
  const first = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim();
  return first || 'unknown';
}

/** 429 with `Retry-After` and a human message in minutes. */
export function tooManyRequests(retryAfterSeconds: number, locale?: string): NextResponse {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const error =
    locale === 'en'
      ? `Too many attempts, try again in ${minutes} min`
      : `Слишком много попыток, попробуйте через ${minutes} мин`;
  return NextResponse.json(
    { error, code: 'RATE_LIMITED' },
    { status: 429, headers: { 'Retry-After': String(seconds) } },
  );
}
