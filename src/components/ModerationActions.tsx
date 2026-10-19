'use client';

import React, { useId, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { Sheet } from '@/components/ui';
import { fillModeration, moderationText } from '@/i18n/messages/features/moderation';

/**
 * «Пожаловаться» and «Заблокировать» for another person (R33): in a friend's profile on /friends,
 * the group members list and the member page. `ReportSheet` alone is used for a reaction.
 * Works on the site and in the app (fetch to /api/* is routed by the native bridge).
 */

export type ReportContext = 'profile' | 'group' | 'reaction';
const REASONS = ['spam', 'abuse', 'inappropriate', 'cheating', 'other'] as const;
type Reason = (typeof REASONS)[number];
const TEXT_MAX = 500;

async function postJson(url: string, method: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

/** Blocks `userId`; resolves to an error text or null. */
export async function blockUserRequest(userId: string): Promise<string | null> {
  try {
    const result = await postJson('/api/blocks', 'POST', { userId });
    return result.ok ? null : typeof result.data.error === 'string' ? result.data.error : String(result.status);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function ReportSheet({
  targetUserId,
  targetUsername,
  context,
  contextId,
  contextLabel,
  onClose,
  onSent,
}: {
  targetUserId: string;
  targetUsername: string;
  context: ReportContext;
  contextId?: string | null;
  /** Group name for 'group', the emoji for 'reaction'. */
  contextLabel?: string | null;
  onClose(): void;
  onSent?(message: string): void;
}) {
  const { locale } = useI18n();
  const text = moderationText(locale);
  const [reason, setReason] = useState<Reason | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reason || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await postJson('/api/reports', 'POST', {
        targetUserId,
        context,
        contextId: contextId ?? null,
        reason,
        text: details.trim() || null,
      });
      if (result.ok) {
        onSent?.(text.reportSent);
        onClose();
        return;
      }
      setError(result.status === 429 ? text.rateLimited : typeof result.data.error === 'string' ? result.data.error : text.reportError);
    } catch {
      setError(text.reportError);
    } finally {
      setSending(false);
    }
  };

  const subtitle =
    context === 'group' && contextLabel
      ? fillModeration(text.reportInGroup, { group: contextLabel })
      : context === 'reaction' && contextLabel
        ? fillModeration(text.reportOnReaction, { emoji: contextLabel })
        : null;

  const title = fillModeration(text.reportTitle, { name: targetUsername });

  // Общее окно над шапкой: заголовок и кнопки закреплены, причины и текст прокручиваются внутри.
  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        <div style={buttonRow}>
          <button type="button" style={btnSecondary} onClick={onClose}>
            {text.cancel}
          </button>
          <button type="submit" form={formId} style={{ ...btnDanger, opacity: !reason || sending ? 0.6 : 1 }} disabled={!reason || sending}>
            {sending ? text.sending : text.send}
          </button>
        </div>
      }
    >
      <form id={formId} style={formStack} onSubmit={submit} data-testid="report-sheet">
        {subtitle ? <div style={muted}>{subtitle}</div> : null}

        <fieldset style={fieldset}>
          <legend style={legend}>{text.reasonLabel}</legend>
          {REASONS.map((value) => (
            <label key={value} style={radioRow}>
              <input type="radio" name="report-reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
              <span>{text.reasons[value]}</span>
            </label>
          ))}
        </fieldset>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={legend}>{text.textLabel}</span>
          <textarea
            value={details}
            maxLength={TEXT_MAX}
            rows={4}
            onChange={(e) => setDetails(e.target.value.slice(0, TEXT_MAX))}
            style={textarea}
          />
          <span style={{ ...muted, justifySelf: 'end' }}>{fillModeration(text.textCounter, { n: details.length, max: TEXT_MAX })}</span>
        </label>

        {error ? <div style={errorText} role="alert">{error}</div> : null}
      </form>
    </Sheet>
  );
}

/**
 * Two buttons for another person. `onBlocked` runs after a successful block (reload the lists);
 * `onMessage` gets the success / error text to show in the page's banner.
 */
export default function ModerationActions({
  targetUserId,
  targetUsername,
  context,
  contextId,
  contextLabel,
  onBlocked,
  onMessage,
  compact = false,
}: {
  targetUserId: string;
  targetUsername: string;
  context: Exclude<ReportContext, 'reaction'>;
  contextId?: string | null;
  contextLabel?: string | null;
  onBlocked?(): void;
  onMessage?(message: string, kind: 'info' | 'error'): void;
  compact?: boolean;
}) {
  const { locale } = useI18n();
  const text = moderationText(locale);
  const [reportOpen, setReportOpen] = useState(false);
  const [blocking, setBlocking] = useState(false);

  const block = async () => {
    if (blocking) return;
    if (!window.confirm(fillModeration(text.blockConfirm, { name: targetUsername }))) return;
    setBlocking(true);
    const error = await blockUserRequest(targetUserId);
    setBlocking(false);
    if (error) {
      onMessage?.(`${text.blockError}: ${error}`, 'error');
      return;
    }
    // Reload first: a page's reload may clear its banner, the message comes after it.
    onBlocked?.();
    onMessage?.(fillModeration(text.blocked, { name: targetUsername }), 'info');
  };

  const size: React.CSSProperties = compact ? { padding: '6px 10px', fontSize: 12 } : {};

  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }} data-testid="moderation-actions">
      <button
        type="button"
        style={{ ...btnSecondary, ...size }}
        onClick={() => setReportOpen(true)}
        aria-label={fillModeration(text.reportAria, { name: targetUsername })}
      >
        {text.report}
      </button>
      <button
        type="button"
        style={{ ...btnDangerOutline, ...size, opacity: blocking ? 0.6 : 1 }}
        disabled={blocking}
        onClick={() => void block()}
        aria-label={fillModeration(text.blockAria, { name: targetUsername })}
      >
        {text.block}
      </button>
      {reportOpen ? (
        <ReportSheet
          targetUserId={targetUserId}
          targetUsername={targetUsername}
          context={context}
          contextId={contextId}
          contextLabel={contextLabel}
          onClose={() => setReportOpen(false)}
          onSent={(message) => onMessage?.(message, 'info')}
        />
      ) : null}
    </span>
  );
}

const formStack: React.CSSProperties = { display: 'grid', gap: 12 };
const muted: React.CSSProperties = { color: '#64748b', fontSize: 13 };
const fieldset: React.CSSProperties = { border: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 };
const legend: React.CSSProperties = { fontWeight: 800, fontSize: 14, marginBottom: 4 };
const radioRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, cursor: 'pointer' };
const textarea: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid #cbd5e1',
  borderRadius: 12,
  padding: 10,
  fontSize: 15,
  fontFamily: 'inherit',
  resize: 'vertical',
};
const errorText: React.CSSProperties = { color: '#b91c1c', fontSize: 14 };
const buttonRow: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' };

const btnBase: React.CSSProperties = {
  border: '1px solid #cbd5e1',
  borderRadius: 999,
  padding: '8px 14px',
  fontWeight: 800,
  fontSize: 13,
  cursor: 'pointer',
  background: '#fff',
  color: '#0f172a',
  whiteSpace: 'nowrap',
};
const btnSecondary: React.CSSProperties = btnBase;
const btnDanger: React.CSSProperties = { ...btnBase, border: '1px solid #dc2626', background: '#dc2626', color: '#fff' };
const btnDangerOutline: React.CSSProperties = { ...btnBase, border: '1px solid #fca5a5', color: '#b91c1c' };
