'use client';

import Image from 'next/image';
import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { fillModeration, moderationText } from '@/i18n/messages/features/moderation';
import { mediaUrl } from '@/lib/platform';

type BlockedUser = { userId: string; username: string; avatarPath: string | null; createdAt: string };

/** «Заблокированные» in the profile (R33.2): people I blocked, with «Разблокировать». */
export default function BlockedUsers() {
  const { locale } = useI18n();
  const text = moderationText(locale);
  const [blocks, setBlocks] = useState<BlockedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/blocks', { cache: 'no-store', credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { blocks?: BlockedUser[] };
      setBlocks(Array.isArray(data.blocks) ? data.blocks : []);
      setError(null);
    } catch {
      setError(text.loadError);
    }
  }, [text.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const unblock = async (row: BlockedUser) => {
    if (!window.confirm(fillModeration(text.unblockConfirm, { name: row.username }))) return;
    setBusyId(row.userId);
    setInfo(null);
    try {
      const res = await fetch('/api/blocks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: row.userId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setBlocks((prev) => (prev ?? []).filter((b) => b.userId !== row.userId));
      setInfo(fillModeration(text.unblocked, { name: row.username }));
      setError(null);
    } catch {
      setError(text.loadError);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section style={panelCard} data-testid="blocked-users">
      <div style={sectionTitle}>{text.blockedTitle}</div>
      <div style={fieldHint}>{text.blockedHint}</div>
      {error ? <div style={{ color: '#b91c1c', fontSize: 14 }}>{error}</div> : null}
      {info ? <div style={{ color: '#047857', fontSize: 14 }}>{info}</div> : null}
      {blocks && blocks.length === 0 ? <div style={fieldHint}>{text.blockedEmpty}</div> : null}
      {blocks && blocks.length ? (
        <ul style={list}>
          {blocks.map((row) => {
            const avatar = mediaUrl(row.avatarPath);
            return (
              <li key={row.userId} style={item}>
                <span style={avatarBox}>
                  {avatar ? <Image src={avatar} alt="" width={28} height={28} unoptimized style={{ width: 28, height: 28, objectFit: 'cover' }} /> : null}
                </span>
                <span style={{ fontWeight: 800, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.username}</span>
                <button type="button" style={button} disabled={busyId === row.userId} onClick={() => void unblock(row)}>
                  {text.unblock}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

const panelCard: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 'clamp(18px, 3vw, 24px)',
  borderRadius: 28,
  border: '1px solid rgba(255, 255, 255, 0.86)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(248, 250, 252, 0.88) 100%)',
  boxShadow: '0 20px 52px rgba(15, 23, 42, 0.08)',
};
const sectionTitle: React.CSSProperties = { fontSize: 18, fontWeight: 900, color: '#0f172a' };
const fieldHint: React.CSSProperties = { fontSize: 13, color: '#64748b', lineHeight: 1.5 };
const list: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 };
const item: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 };
const avatarBox: React.CSSProperties = {
  width: 28,
  height: 28,
  flex: '0 0 28px',
  borderRadius: 999,
  overflow: 'hidden',
  background: '#e2e8f0',
  display: 'inline-flex',
};
const button: React.CSSProperties = {
  marginLeft: 'auto',
  border: '1px solid #cbd5e1',
  borderRadius: 999,
  padding: '8px 14px',
  fontWeight: 800,
  fontSize: 13,
  background: '#fff',
  color: '#0f172a',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
