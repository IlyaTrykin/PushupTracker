'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { getIntlLocale, t } from '@/i18n/translate';

type UserRow = {
  id: string;
  email: string;
  username: string;
  avatarPath?: string | null;
  isAdmin: boolean;
  createdAt?: string;
  lastActiveAt?: string | null;
  deletedAt?: string | null;
};

type RowState = UserRow & { dirty?: boolean; saving?: boolean; sendingReset?: boolean; uploadingAvatar?: boolean };

type RewardRow = {
  id: string;
  message: string;
  minPoints: number;
  createdAt?: string;
  updatedAt?: string;
};

type RewardRowState = RewardRow & { dirty?: boolean; saving?: boolean; deleting?: boolean };

function fmtDate(v: string | null | undefined, locale: string): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(locale);
}

/** Короткая дата для карточки списка — время там только мешает на телефоне. */
function fmtDay(v: string | null | undefined, locale: string): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' });
}

async function resizeToWebp256(file: File): Promise<Blob> {
  const img = document.createElement('img');
  img.decoding = 'async';
  const url = URL.createObjectURL(file);

  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('LOAD_ERROR'));
      img.src = url;
    });

    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('NO_CTX');

    const sw = img.naturalWidth;
    const sh = img.naturalHeight;
    const s = Math.min(sw, sh);
    const sx = Math.floor((sw - s) / 2);
    const sy = Math.floor((sh - s) / 2);

    ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('BLOB_ERROR'))), 'image/webp', 0.82);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Модальное окно. Собственный `<style jsx>` — на «хром» окна; содержимое
 * пишется в родителе, поэтому его классы остаются в области видимости родителя.
 */
function Modal({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button type="button" className="modal-close" onClick={onClose} aria-label={closeLabel}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 90;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 14px;
          background: rgba(15, 23, 42, 0.34);
          backdrop-filter: blur(6px);
        }
        .modal {
          width: min(520px, 100%);
          max-height: calc(100vh - 28px);
          overflow: auto;
          padding: 18px;
          border-radius: 26px;
          border: 1px solid rgba(255, 255, 255, 0.86);
          background: rgba(255, 255, 255, 0.98);
          box-shadow: 0 28px 64px rgba(15, 23, 42, 0.24);
        }
        .modal-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding-bottom: 14px;
          margin-bottom: 14px;
          border-bottom: 1px solid rgba(226, 232, 240, 0.96);
        }
        .modal-title {
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
          letter-spacing: -0.02em;
        }
        .modal-close {
          width: 38px;
          height: 38px;
          flex: 0 0 auto;
          border-radius: 13px;
          border: 1px solid rgba(148, 163, 184, 0.26);
          background: rgba(255, 255, 255, 0.86);
          color: #475569;
          cursor: pointer;
        }
        .modal-body {
          display: grid;
          gap: 14px;
        }
      `}</style>
    </div>
  );
}

export default function AdminUsersClient() {
  const { locale } = useI18n();
  const localeTag = getIntlLocale(locale);
  const tt = useCallback((input: string) => t(locale, input), [locale]);
  const [rows, setRows] = useState<RowState[]>([]);
  const [rewardRows, setRewardRows] = useState<RewardRowState[]>([]);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rewardsOpen, setRewardsOpen] = useState(false);

  const [newEmail, setNewEmail] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [newRewardMessage, setNewRewardMessage] = useState('');
  const [newRewardMinPoints, setNewRewardMinPoints] = useState('0.1');

  // Удалённые уезжают вниз: в списке они только мешают.
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const deletedDiff = Number(Boolean(a.deletedAt)) - Number(Boolean(b.deletedAt));
        if (deletedDiff) return deletedDiff;
        return a.username.localeCompare(b.username, 'ru');
      }),
    [rows],
  );
  const sortedRewards = useMemo(() => [...rewardRows].sort((a, b) => a.minPoints - b.minPoints), [rewardRows]);
  const detailRow = useMemo(() => rows.find((r) => r.id === detailId) ?? null, [rows, detailId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [usersRes, rewardsRes] = await Promise.all([
      fetch('/api/admin/users', { cache: 'no-store' }),
      fetch('/api/admin/workout-rewards', { cache: 'no-store' }),
    ]);
    const usersData = await usersRes.json().catch(() => ({}));
    const rewardsData = await rewardsRes.json().catch(() => ({}));

    if (!usersRes.ok) {
      setError(tt(usersData.error || 'Ошибка загрузки'));
      setRows([]);
    } else {
      setRows(
        (usersData.users || []).map((u: UserRow) => ({
          ...u,
          dirty: false,
          saving: false,
          sendingReset: false,
          uploadingAvatar: false,
        })),
      );
    }

    if (!rewardsRes.ok) {
      setError((prev) => prev || tt(rewardsData.error || 'Ошибка загрузки поощрений'));
      setRewardRows([]);
    } else {
      setRewardRows(
        (rewardsData.rewards || []).map((reward: RewardRow) => ({
          ...reward,
          message: typeof reward.message === 'string' ? tt(reward.message) : reward.message,
          dirty: false,
          saving: false,
          deleting: false,
        })),
      );
    }

    setLoading(false);
  }, [tt]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateRow(id: string, patch: Partial<UserRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, dirty: true } : r)));
  }

  function updateRewardRow(id: string, patch: Partial<RewardRow>) {
    setRewardRows((prev) => prev.map((reward) => (reward.id === id ? { ...reward, ...patch, dirty: true } : reward)));
  }

  function openCreate() {
    setError('');
    setNewEmail('');
    setNewUsername('');
    setNewPassword('');
    setNewIsAdmin(false);
    setCreateOpen(true);
  }

  async function createUser() {
    setError('');
    setCreating(true);
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: newEmail,
        username: newUsername,
        password: newPassword,
        isAdmin: newIsAdmin,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setCreating(false);
    if (!res.ok) {
      setError(tt(data.error || 'Ошибка создания'));
      return;
    }

    setNewEmail('');
    setNewUsername('');
    setNewPassword('');
    setNewIsAdmin(false);
    setCreateOpen(false);
    await load();
  }

  async function createReward() {
    setError('');
    const res = await fetch('/api/admin/workout-rewards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: newRewardMessage,
        minPoints: newRewardMinPoints,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(tt(data.error || 'Ошибка создания поощрения'));
      return;
    }

    setNewRewardMessage('');
    setNewRewardMinPoints('0.1');
    await load();
  }

  async function saveRow(r: RowState) {
    setError('');
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, saving: true } : x)));

    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: r.id,
        email: r.email,
        username: r.username,
        isAdmin: r.isAdmin,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(tt(data.error || 'Ошибка сохранения'));
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, saving: false } : x)));
      return;
    }

    await load();
  }

  async function saveRewardRow(r: RewardRowState) {
    setError('');
    setRewardRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, saving: true } : x)));

    const res = await fetch('/api/admin/workout-rewards', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: r.id,
        message: r.message,
        minPoints: r.minPoints,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(tt(data.error || 'Ошибка сохранения поощрения'));
      setRewardRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, saving: false } : x)));
      return;
    }

    await load();
  }

  async function deleteRow(id: string) {
    if (!window.confirm(tt('Удалить пользователя?'))) return;
    setError('');
    const res = await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(tt(data.error || 'Ошибка удаления'));
      return;
    }
    await load();
  }

  async function deleteRewardRow(id: string) {
    if (!window.confirm(tt('Удалить поощрение?'))) return;
    setError('');
    setRewardRows((prev) => prev.map((x) => (x.id === id ? { ...x, deleting: true } : x)));
    const res = await fetch('/api/admin/workout-rewards', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(tt(data.error || 'Ошибка удаления поощрения'));
      setRewardRows((prev) => prev.map((x) => (x.id === id ? { ...x, deleting: false } : x)));
      return;
    }
    await load();
  }

  async function restoreRow(id: string) {
    setError('');
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, restore: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(tt(data.error || 'Ошибка восстановления'));
      return;
    }
    await load();
  }

  async function sendReset(r: RowState) {
    setError('');
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, sendingReset: true } : x)));

    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: r.id, sendResetLink: true }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(tt(data.error || 'Не удалось отправить письмо'));
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, sendingReset: false } : x)));
      return;
    }

    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, sendingReset: false } : x)));
    window.alert(tt(`Ссылка для сброса пароля отправлена на ${r.email}`));
  }

  async function uploadAvatar(r: RowState, file: File) {
    setError('');
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, uploadingAvatar: true } : x)));

    try {
      const blob = await resizeToWebp256(file);
      if (blob.size > 300_000) {
        setError(tt('Аватар получился слишком большим. Выберите более простое изображение.'));
        return;
      }

      const form = new FormData();
      form.append('id', r.id);
      form.append('file', new File([blob], 'avatar.webp', { type: 'image/webp' }));

      const res = await fetch('/api/admin/users/avatar', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(tt(data.error || 'Ошибка загрузки аватара'));
        return;
      }

      await load();
    } catch {
      setError(tt('Не удалось обработать изображение'));
    } finally {
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, uploadingAvatar: false } : x)));
    }
  }

  if (loading) return <div style={{ padding: 16 }}>{tt('Загрузка...')}</div>;

  return (
    <div className="admin-users-wrap">
      <div className="admin-users-head">
        <div>
          <div className="eyebrow">{tt('Admin control')}</div>
          <h1>{tt('Пользователи и поощрения')}</h1>
          <p>{tt('Управление профилями, правами доступа, паролями и поощрениями.')}</p>
          <p className="muted">{tt('Нажмите на пользователя, чтобы открыть все данные и действия.')}</p>
        </div>
        <button className="btn btn-secondary" onClick={load}>{tt('Обновить')}</button>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">{tt('Пользователи')}</span>
          <span className="count">{sorted.length}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={openCreate}
            aria-label={tt('Создать пользователя')}
            title={tt('Создать пользователя')}
          >
            +
          </button>
        </div>

        <ul className="user-list">
          {sorted.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={`user-card${r.deletedAt ? ' user-card-deleted' : ''}`}
                onClick={() => setDetailId(r.id)}
              >
                {r.avatarPath ? (
                  <Image className="avatar-preview" src={r.avatarPath} alt="" width={44} height={44} unoptimized />
                ) : (
                  <span className="avatar-preview avatar-fallback">{(r.username || 'U').slice(0, 1).toUpperCase()}</span>
                )}

                <span className="user-main">
                  <span className="user-name">
                    <span className="user-nick">{r.username}</span>
                    {r.isAdmin ? <span className="chip">{tt('Админ')}</span> : null}
                    {r.deletedAt ? <span className="chip chip-danger">{tt('Удален')}</span> : null}
                  </span>
                  <span className="user-meta">
                    <span>
                      {tt('Регистрация')}: {fmtDay(r.createdAt, localeTag)}
                    </span>
                    <span>
                      {tt('Активность')}: {fmtDay(r.lastActiveAt, localeTag)}
                    </span>
                  </span>
                </span>

                <span className="chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}

          {!sorted.length ? <li className="empty-row">{tt('Пользователей нет.')}</li> : null}
        </ul>
      </section>

      <section className="panel">
        <button
          type="button"
          className="disclosure"
          onClick={() => setRewardsOpen((v) => !v)}
          aria-expanded={rewardsOpen}
        >
          <span className="panel-title">{tt('Поощрения за подход')}</span>
          <span className="count">{sortedRewards.length}</span>
          <span className="disclosure-icon" aria-hidden="true">
            {rewardsOpen ? '−' : '+'}
          </span>
        </button>

        {rewardsOpen ? (
          <div className="disclosure-body">
            <p>{tt('Поощрение выбирается по максимальному порогу, который не превышает баллы за подход.')}</p>
            <p className="muted">
              {tt('Баллы: 1 отжимание = 1, 1 подтягивание = 3, 1 приседание = 0.7, 1 скручивание = 0.5, 10 секунд планки = 1.')}
            </p>

            <div className="reward-create-grid">
              <input
                className="text-input"
                placeholder={tt('Текст поощрения')}
                value={newRewardMessage}
                onChange={(e) => setNewRewardMessage(e.target.value)}
              />
              <input
                className="text-input"
                type="number"
                min="0"
                step="0.1"
                placeholder={tt('Минимум баллов')}
                value={newRewardMinPoints}
                onChange={(e) => setNewRewardMinPoints(e.target.value)}
              />
              <button className="btn" onClick={createReward}>{tt('Добавить поощрение')}</button>
            </div>

            <div className="users-table-wrap">
              <table className="reward-table">
                <thead>
                  <tr>
                    <th>{tt('Порог, баллы')}</th>
                    <th>{tt('Текст')}</th>
                    <th>{tt('Обновлено')}</th>
                    <th>{tt('Действия')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRewards.map((reward) => (
                    <tr key={reward.id}>
                      <td className="reward-points-cell">
                        <input
                          className="text-input"
                          type="number"
                          min="0"
                          step="0.1"
                          value={String(reward.minPoints)}
                          onChange={(e) => updateRewardRow(reward.id, { minPoints: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          className="text-input"
                          value={reward.message}
                          onChange={(e) => updateRewardRow(reward.id, { message: e.target.value })}
                        />
                      </td>
                      <td>{fmtDate(reward.updatedAt, localeTag)}</td>
                      <td>
                        <div className="actions-cell">
                          <button
                            className="btn"
                            disabled={!reward.dirty || !!reward.saving || !!reward.deleting}
                            onClick={() => saveRewardRow(reward)}
                          >
                            {reward.saving ? tt('Сохранение...') : tt('Сохранить')}
                          </button>
                          <button
                            className="btn btn-danger"
                            disabled={!!reward.saving || !!reward.deleting}
                            onClick={() => deleteRewardRow(reward.id)}
                          >
                            {reward.deleting ? tt('Удаление...') : tt('Удалить')}
                          </button>
                        </div>
                        <div className="muted">ID: {reward.id}</div>
                      </td>
                    </tr>
                  ))}

                  {!sortedRewards.length ? (
                    <tr>
                      <td colSpan={4} className="empty-row">{tt('Поощрений пока нет.')}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      {createOpen ? (
        <Modal title={tt('Создать пользователя')} closeLabel={tt('Закрыть')} onClose={() => setCreateOpen(false)}>
          <label className="field">
            <span className="field-label">Email</span>
            <input className="text-input" placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">{tt('Пользователь')}</span>
            <input
              className="text-input"
              placeholder={tt('Username (опционально)')}
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">{tt('Пароль (>=6)')}</span>
            <input
              className="text-input"
              type="password"
              placeholder={tt('Пароль (>=6)')}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={newIsAdmin} onChange={(e) => setNewIsAdmin(e.target.checked)} />
            {tt('Администратор')}
          </label>

          <div className="modal-actions">
            <button className="btn" disabled={creating} onClick={createUser}>
              {creating ? tt('Сохранение...') : tt('Создать')}
            </button>
            <button className="btn btn-secondary" onClick={() => setCreateOpen(false)}>{tt('Отмена')}</button>
          </div>
        </Modal>
      ) : null}

      {detailRow ? (
        <Modal title={tt('Детали пользователя')} closeLabel={tt('Закрыть')} onClose={() => setDetailId(null)}>
          <div className="detail-top">
            {detailRow.avatarPath ? (
              <Image className="avatar-lg" src={detailRow.avatarPath} alt="" width={64} height={64} unoptimized />
            ) : (
              <span className="avatar-lg avatar-fallback">{(detailRow.username || 'U').slice(0, 1).toUpperCase()}</span>
            )}
            <div className="detail-ident">
              <div className="detail-name">{detailRow.username}</div>
              <label className={`btn btn-secondary btn-file${detailRow.deletedAt ? ' btn-disabled' : ''}`}>
                {detailRow.uploadingAvatar ? tt('Загрузка...') : tt('Изменить')}
                <input
                  type="file"
                  accept="image/*"
                  disabled={!!detailRow.uploadingAvatar || !!detailRow.deletedAt}
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    if (f) void uploadAvatar(detailRow, f);
                  }}
                />
              </label>
            </div>
          </div>

          <label className="field">
            <span className="field-label">{tt('Пользователь')}</span>
            <input
              className="text-input"
              value={detailRow.username}
              onChange={(e) => updateRow(detailRow.id, { username: e.target.value })}
            />
          </label>

          <label className="field">
            <span className="field-label">Email</span>
            <input
              className="text-input"
              value={detailRow.email}
              onChange={(e) => updateRow(detailRow.id, { email: e.target.value })}
            />
          </label>

          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={detailRow.isAdmin}
              onChange={(e) => updateRow(detailRow.id, { isAdmin: e.target.checked })}
            />
            {tt('Администратор')}
          </label>

          <div className="detail-facts">
            <div>
              <span className="fact-label">{tt('Дата создания')}</span>
              <span className="fact-value">{fmtDate(detailRow.createdAt, localeTag)}</span>
            </div>
            <div>
              <span className="fact-label">{tt('Последняя активность')}</span>
              <span className="fact-value">{fmtDate(detailRow.lastActiveAt, localeTag)}</span>
            </div>
            <div>
              <span className="fact-label">{tt('Статус')}</span>
              <span className="fact-value">
                {detailRow.deletedAt ? `${tt('Удален')}: ${fmtDate(detailRow.deletedAt, localeTag)}` : tt('Активен')}
              </span>
            </div>
            <div>
              <span className="fact-label">ID</span>
              <span className="fact-value fact-id">{detailRow.id}</span>
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn" disabled={!detailRow.dirty || !!detailRow.saving} onClick={() => saveRow(detailRow)}>
              {detailRow.saving ? tt('Сохранение...') : tt('Сохранить')}
            </button>
            <button
              className="btn btn-secondary"
              disabled={!!detailRow.sendingReset || !!detailRow.deletedAt}
              onClick={() => sendReset(detailRow)}
            >
              {detailRow.sendingReset ? tt('Отправка...') : tt('Сбросить пароль')}
            </button>
            {detailRow.deletedAt ? (
              <button className="btn btn-secondary" onClick={() => restoreRow(detailRow.id)}>{tt('Восстановить')}</button>
            ) : (
              <button className="btn btn-danger" onClick={() => deleteRow(detailRow.id)}>{tt('Удалить')}</button>
            )}
          </div>
        </Modal>
      ) : null}

      <style jsx>{`
        .admin-users-wrap {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0;
          display: grid;
          gap: 18px;
        }
        .admin-users-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          padding: clamp(18px, 3vw, 28px);
          border-radius: 30px;
          border: 1px solid rgba(251, 146, 60, 0.24);
          background:
            radial-gradient(circle at top right, rgba(251, 146, 60, 0.16), transparent 28%),
            linear-gradient(145deg, rgba(255, 250, 243, 0.96) 0%, rgba(255, 255, 255, 0.92) 54%, rgba(239, 246, 255, 0.9) 100%);
          box-shadow: 0 28px 80px rgba(15, 23, 42, 0.12);
        }
        .eyebrow {
          margin-bottom: 8px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #c2410c;
        }
        h1 {
          margin: 0 0 8px;
          color: #0f172a;
          font-size: clamp(26px, 4vw, 42px);
          line-height: 0.98;
          font-weight: 900;
          letter-spacing: -0.05em;
        }
        p {
          margin: 0;
          color: #475569;
          line-height: 1.6;
        }
        .panel {
          border: 1px solid rgba(255, 255, 255, 0.86);
          border-radius: 28px;
          padding: clamp(14px, 2.4vw, 20px);
          display: grid;
          gap: 14px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(248, 250, 252, 0.88) 100%);
          box-shadow: 0 22px 56px rgba(15, 23, 42, 0.08);
        }
        .panel-head {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .panel-title {
          color: #0f172a;
          font-size: clamp(18px, 2.4vw, 22px);
          font-weight: 900;
          letter-spacing: -0.03em;
        }
        .count {
          padding: 3px 9px;
          border-radius: 999px;
          background: rgba(226, 232, 240, 0.8);
          color: #475569;
          font-size: 12px;
          font-weight: 800;
        }
        .icon-btn {
          width: 38px;
          height: 38px;
          flex: 0 0 auto;
          border: none;
          border-radius: 13px;
          background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
          box-shadow: 0 12px 24px rgba(234, 88, 12, 0.24);
          color: #fff;
          font-size: 22px;
          line-height: 1;
          font-weight: 800;
          cursor: pointer;
        }
        .disclosure {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 0;
          border: none;
          background: none;
          text-align: left;
          cursor: pointer;
        }
        .disclosure-icon {
          margin-left: auto;
          width: 34px;
          height: 34px;
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          border: 1px solid rgba(148, 163, 184, 0.26);
          background: rgba(255, 255, 255, 0.86);
          color: #475569;
          font-size: 18px;
          font-weight: 800;
        }
        .disclosure-body {
          display: grid;
          gap: 14px;
        }
        .error-box {
          border: 1px solid rgba(248, 113, 113, 0.34);
          background: rgba(254, 226, 226, 0.92);
          color: #991b1b;
          border-radius: 18px;
          padding: 14px 16px;
          font-weight: 700;
        }
        .user-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 8px;
        }
        .user-card {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 18px;
          border: 1px solid rgba(226, 232, 240, 0.95);
          background: rgba(255, 255, 255, 0.86);
          text-align: left;
          cursor: pointer;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
        }
        .user-card:hover {
          border-color: rgba(249, 115, 22, 0.34);
          box-shadow: 0 12px 26px rgba(15, 23, 42, 0.08);
        }
        .user-card:active {
          transform: scale(0.995);
        }
        .user-card-deleted {
          opacity: 0.62;
        }
        .user-main {
          min-width: 0;
          flex: 1 1 auto;
          display: grid;
          gap: 3px;
        }
        .user-name {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          min-width: 0;
        }
        .user-nick {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #0f172a;
          font-size: 15px;
          font-weight: 800;
          letter-spacing: -0.01em;
        }
        .chip {
          padding: 2px 8px;
          border-radius: 999px;
          background: rgba(255, 237, 213, 0.9);
          border: 1px solid rgba(249, 115, 22, 0.22);
          color: #c2410c;
          font-size: 11px;
          font-weight: 800;
          white-space: nowrap;
        }
        .chip-danger {
          background: rgba(254, 226, 226, 0.92);
          border-color: rgba(239, 68, 68, 0.22);
          color: #b91c1c;
        }
        .user-meta {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          color: #64748b;
          font-size: 12px;
          line-height: 1.3;
        }
        .chevron {
          flex: 0 0 auto;
          color: #94a3b8;
          font-size: 22px;
          line-height: 1;
        }
        .avatar-preview {
          width: 44px;
          height: 44px;
          border-radius: 999px;
          object-fit: cover;
          border: 1px solid rgba(226, 232, 240, 0.95);
          flex: 0 0 auto;
          background: rgba(255, 255, 255, 0.88);
        }
        .avatar-lg {
          width: 64px;
          height: 64px;
          border-radius: 999px;
          object-fit: cover;
          border: 1px solid rgba(226, 232, 240, 0.95);
          flex: 0 0 auto;
          background: rgba(255, 255, 255, 0.88);
        }
        .avatar-fallback {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          color: #374151;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.88) 0%, rgba(226, 232, 240, 0.92) 100%);
        }
        .detail-top {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .detail-ident {
          min-width: 0;
          display: grid;
          gap: 8px;
          justify-items: start;
        }
        .detail-name {
          color: #0f172a;
          font-size: 17px;
          font-weight: 900;
          letter-spacing: -0.02em;
          word-break: break-word;
        }
        .field {
          display: grid;
          gap: 6px;
        }
        .field-label {
          color: #475569;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .detail-facts {
          display: grid;
          gap: 8px;
          padding: 12px;
          border-radius: 16px;
          border: 1px solid rgba(226, 232, 240, 0.95);
          background: rgba(248, 250, 252, 0.8);
        }
        .detail-facts > div {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
        }
        .fact-label {
          flex: 0 0 auto;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
        }
        .fact-value {
          min-width: 0;
          color: #0f172a;
          font-size: 13px;
          font-weight: 700;
          text-align: right;
        }
        .fact-id {
          font-size: 11px;
          font-weight: 600;
          word-break: break-all;
        }
        .modal-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .reward-create-grid {
          display: grid;
          grid-template-columns: minmax(0, 2fr) minmax(180px, 220px) auto;
          gap: 10px;
          align-items: end;
        }
        .text-input {
          width: 100%;
          min-height: 48px;
          border: 1px solid rgba(148, 163, 184, 0.28);
          border-radius: 16px;
          padding: 0 14px;
          font-size: 14px;
          color: #0f172a;
          background: rgba(255, 255, 255, 0.88);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
        }
        .btn {
          border: none;
          background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
          box-shadow: 0 16px 30px rgba(234, 88, 12, 0.24);
          color: #fff;
          border-radius: 14px;
          padding: 10px 14px;
          cursor: pointer;
          font-weight: 800;
        }
        .btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .btn-secondary {
          border: 1px solid rgba(148, 163, 184, 0.24);
          background: rgba(255, 255, 255, 0.82);
          box-shadow: none;
          color: #0f172a;
        }
        .btn-danger {
          border: 1px solid rgba(239, 68, 68, 0.22);
          background: rgba(255, 255, 255, 0.86);
          box-shadow: none;
          color: #b91c1c;
        }
        .btn-file {
          position: relative;
          overflow: hidden;
          display: inline-flex;
          align-items: center;
        }
        .btn-file input {
          position: absolute;
          inset: 0;
          opacity: 0;
          width: 100%;
          height: 100%;
          cursor: pointer;
          border: 0;
          padding: 0;
          margin: 0;
        }
        .btn-disabled {
          opacity: 0.55;
          pointer-events: none;
        }
        .users-table-wrap {
          overflow-x: auto;
          border: 1px solid rgba(226, 232, 240, 0.95);
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.7);
        }
        .reward-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 760px;
        }
        th, td {
          border-bottom: 1px solid rgba(226, 232, 240, 0.95);
          padding: 12px 10px;
          text-align: left;
          vertical-align: top;
        }
        th {
          background: rgba(248, 250, 252, 0.84);
          font-size: 13px;
          font-weight: 800;
          color: #475569;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        td {
          font-size: 14px;
          color: #0f172a;
        }
        .actions-cell {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 8px;
        }
        .reward-points-cell {
          min-width: 160px;
        }
        .muted {
          font-size: 12px;
          color: #64748b;
          margin-top: 6px;
          word-break: break-all;
        }
        .checkbox-line {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .empty-row {
          text-align: center;
          color: #6b7280;
          padding: 20px;
          list-style: none;
        }
        @media (max-width: 1024px) {
          .reward-create-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 520px) {
          .admin-users-head {
            border-radius: 24px;
          }
          .panel {
            border-radius: 22px;
          }
          .user-meta {
            gap: 2px;
            flex-direction: column;
          }
          .modal-actions .btn {
            flex: 1 1 100%;
          }
        }
      `}</style>
    </div>
  );
}
