'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type CSSProperties, FormEvent, useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { t } from '@/i18n/translate';

type GroupListItem = {
  id: string;
  name: string;
  owner: { id: string; username: string; avatarPath?: string | null };
  ownerId: string;
  memberCount: number;
  pendingRequestCount: number;
  canManage: boolean;
  isOwner: boolean;
  joinedAt: string | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function fetchJsonSafe<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch {}
  }
  if (!res.ok) {
    const message = typeof (data as { error?: unknown })?.error === 'string'
      ? String((data as { error: string }).error)
      : `Ошибка (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export default function GroupsPage() {
  const { locale } = useI18n();
  const tt = (input: string) => t(locale, input);
  const searchParams = useSearchParams();
  const inviteParam = searchParams.get('invite') || '';

  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [joinToken, setJoinToken] = useState('');
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [submittingJoin, setSubmittingJoin] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [actionMode, setActionMode] = useState<'create' | 'join' | null>(inviteParam ? 'join' : null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonSafe<{ groups: GroupListItem[] }>('/api/groups');
      setGroups(Array.isArray(data.groups) ? data.groups : []);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (inviteParam) {
      setJoinToken(inviteParam);
      setActionMode('join');
      setActionMenuOpen(true);
    }
  }, [inviteParam]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setSubmittingCreate(true);
    setError(null);
    setInfo(null);
    try {
      const data = await fetchJsonSafe<{ group: GroupListItem }>('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName }),
      });
      setNewGroupName('');
      setActionMenuOpen(false);
      setActionMode(null);
      setInfo(tt('Группа создана'));
      await load();
      if (data.group?.id) {
        window.location.href = `/groups/${data.group.id}`;
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSubmittingCreate(false);
    }
  }

  async function handleJoin(event: FormEvent) {
    event.preventDefault();
    setSubmittingJoin(true);
    setError(null);
    setInfo(null);
    try {
      const data = await fetchJsonSafe<{ group?: { name?: string } }>('/api/groups/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: joinToken }),
      });
      setJoinToken('');
      setActionMenuOpen(false);
      setActionMode(null);
      setInfo(data.group?.name ? `${tt('Заявка отправлена в группу')}: ${data.group.name}` : tt('Заявка отправлена'));
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSubmittingJoin(false);
    }
  }

  return (
    <div className="app-page" style={page}>
      <section style={topBar}>
        <div style={viewSwitchWrap}>
          <Link href="/friends" style={viewSwitchBtn}>
            {tt('Друзья')}
          </Link>
          <Link href="/groups" style={{ ...viewSwitchBtn, ...viewSwitchBtnActive }}>
            {tt('Группы')}
          </Link>
        </div>

        <div style={actionDock}>
          <button
            type="button"
            onClick={() => setActionMenuOpen((prev) => !prev)}
            style={btnPlusPrimary}
            aria-label={tt('Открыть действия группы')}
            title={tt('Открыть действия группы')}
          >
            {actionMenuOpen ? '−' : '+'}
          </button>
          <button type="button" onClick={() => void load()} style={btnSecondary}>{tt('Обновить')}</button>
        </div>
      </section>

      {actionMenuOpen ? (
        <section style={card}>
          <div style={actionChoiceRow}>
            <button
              type="button"
              onClick={() => setActionMode('create')}
              style={actionMode === 'create' ? btnPrimary : btnSecondary}
            >
              {tt('Новая')}
            </button>
            <button
              type="button"
              onClick={() => setActionMode('join')}
              style={actionMode === 'join' ? btnPrimary : btnSecondary}
            >
              {tt('Вступить')}
            </button>
          </div>

          {actionMode === 'create' ? (
            <form onSubmit={handleCreate} style={formStack}>
              <input
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                placeholder={tt('Название группы')}
                style={input}
              />
              <button type="submit" style={btnPrimary} disabled={submittingCreate || !newGroupName.trim()}>
                {submittingCreate ? tt('Сохранение…') : tt('Создать')}
              </button>
            </form>
          ) : null}

          {actionMode === 'join' ? (
            <form onSubmit={handleJoin} style={formStack}>
              <input
                value={joinToken}
                onChange={(event) => setJoinToken(event.target.value)}
                placeholder={tt('Токен приглашения')}
                style={input}
              />
              <button type="submit" style={btnPrimary} disabled={submittingJoin || !joinToken.trim()}>
                {submittingJoin ? tt('Сохранение…') : tt('Отправить заявку')}
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      <section style={listWrap}>
        {groups.length === 0 && !loading ? (
          <div style={emptyCard}>{tt('Пока групп нет.')}</div>
        ) : null}

        {groups.map((group) => (
          <article key={group.id} style={listCard}>
            <div style={{ display: 'grid', gap: 8 }}>
              <h3 style={cardTitle}>{group.name}</h3>
              <div style={metaLine}>
                {tt('Владелец')}: {group.owner.username} · {tt('Участников')}: {group.memberCount}
              </div>
              <div style={metaLine}>
                {group.canManage ? `${tt('Ожидают подтверждения')}: ${group.pendingRequestCount}` : tt('Участник')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link href={`/groups/${group.id}`} style={linkButton}>{tt('Открыть')}</Link>
            </div>
          </article>
        ))}
      </section>

      {error ? <p style={errorBanner}>{error}</p> : null}
      {info ? <p style={infoBanner}>{info}</p> : null}
      {loading ? <p style={loadingBanner}>{tt('Загрузка…')}</p> : null}
    </div>
  );
}

const page: CSSProperties = {
  display: 'grid',
  gap: 18,
  maxWidth: 980,
};

const topBar: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
};

const viewSwitchWrap: CSSProperties = {
  display: 'inline-flex',
  gap: 8,
  padding: 6,
  borderRadius: 18,
  background: 'rgba(255, 255, 255, 0.78)',
  border: '1px solid rgba(148, 163, 184, 0.2)',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.08)',
};

const viewSwitchBtn: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 14,
  textDecoration: 'none',
  color: '#0f172a',
  fontWeight: 800,
  background: 'transparent',
};

const viewSwitchBtnActive: CSSProperties = {
  background: 'linear-gradient(135deg, #0f766e 0%, #0d9488 100%)',
  color: '#fff',
  boxShadow: '0 12px 24px rgba(13, 148, 136, 0.18)',
};

const actionDock: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  flexWrap: 'wrap',
};

const card: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 18,
  borderRadius: 24,
  border: '1px solid rgba(226, 232, 240, 0.95)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 250, 252, 0.88) 100%)',
  boxShadow: '0 20px 50px rgba(15, 23, 42, 0.08)',
};

const input: CSSProperties = {
  width: '100%',
  borderRadius: 14,
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  fontSize: 15,
};

const btnPlusPrimary: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 14,
  border: 'none',
  background: 'linear-gradient(135deg, #0f766e 0%, #0d9488 100%)',
  boxShadow: '0 14px 24px rgba(13, 148, 136, 0.22)',
  color: '#fff',
  fontWeight: 900,
  fontSize: 22,
  lineHeight: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
};

const btnPrimary: CSSProperties = {
  border: 'none',
  borderRadius: 14,
  padding: '12px 16px',
  background: '#0f766e',
  color: '#fff',
  fontWeight: 800,
  cursor: 'pointer',
};

const btnSecondary: CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.38)',
  borderRadius: 14,
  padding: '12px 16px',
  background: '#fff',
  color: '#0f172a',
  fontWeight: 700,
  cursor: 'pointer',
};

const actionChoiceRow: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
};

const formStack: CSSProperties = {
  display: 'grid',
  gap: 12,
};

const errorBanner: CSSProperties = {
  margin: 0,
  padding: '14px 16px',
  borderRadius: 18,
  color: '#991b1b',
  background: 'rgba(254, 226, 226, 0.92)',
  border: '1px solid rgba(248, 113, 113, 0.28)',
};

const infoBanner: CSSProperties = {
  margin: 0,
  padding: '14px 16px',
  borderRadius: 18,
  color: '#065f46',
  background: 'rgba(209, 250, 229, 0.92)',
  border: '1px solid rgba(16, 185, 129, 0.22)',
};

const loadingBanner: CSSProperties = {
  margin: 0,
  color: '#475569',
};

const listWrap: CSSProperties = {
  display: 'grid',
  gap: 12,
};

const emptyCard: CSSProperties = {
  padding: 18,
  borderRadius: 24,
  border: '1px dashed rgba(148, 163, 184, 0.5)',
  background: 'rgba(255, 255, 255, 0.82)',
  color: '#64748b',
};

const listCard: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 16,
  flexWrap: 'wrap',
  padding: 18,
  borderRadius: 24,
  border: '1px solid rgba(226, 232, 240, 0.95)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 250, 252, 0.88) 100%)',
  boxShadow: '0 18px 42px rgba(15, 23, 42, 0.08)',
};

const cardTitle: CSSProperties = {
  margin: 0,
  color: '#0f172a',
  fontSize: 20,
  fontWeight: 900,
};

const metaLine: CSSProperties = {
  color: '#64748b',
  fontSize: 14,
};

const linkButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '12px 16px',
  borderRadius: 14,
  background: '#0f172a',
  color: '#fff',
  fontWeight: 700,
  textDecoration: 'none',
};
