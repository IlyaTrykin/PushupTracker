'use client';

import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { getIntlLocale, t } from '@/i18n/translate';

type UserRow = {
  id: string;
  email: string;
  username: string;
  avatarPath?: string | null;
  isAdmin: boolean;
  createdAt?: string;
  deletedAt?: string | null;
};

type RowState = UserRow & { dirty?: boolean; saving?: boolean; sendingReset?: boolean; uploadingAvatar?: boolean };

function fmtDate(v: string | null | undefined, locale: string): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(locale);
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

export default function AdminUsersClient() {
  const { locale } = useI18n();
  const localeTag = getIntlLocale(locale);
  const tt = (input: string) => t(locale, input);
  const [rows, setRows] = useState<RowState[]>([]);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  const [newEmail, setNewEmail] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);

  const sorted = useMemo(() => [...rows].sort((a, b) => a.email.localeCompare(b.email, 'ru')), [rows]);

  async function load() {
    setLoading(true);
    setError('');
    const res = await fetch('/api/admin/users', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(tt(data.error || 'Ошибка загрузки'));
      setRows([]);
    } else {
      setRows(
        (data.users || []).map((u: UserRow) => ({
          ...u,
          dirty: false,
          saving: false,
          sendingReset: false,
          uploadingAvatar: false,
        })),
      );
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function updateRow(id: string, patch: Partial<UserRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, dirty: true } : r)));
  }

  async function createUser() {
    setError('');
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
    if (!res.ok) {
      setError(tt(data.error || 'Ошибка создания'));
      return;
    }

    setNewEmail('');
    setNewUsername('');
    setNewPassword('');
    setNewIsAdmin(false);
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
          <p>{tt('Управление профилями, правами доступа и паролями.')}</p>
          <p className="muted">{tt('На узких экранах таблица прокручивается горизонтально.')}</p>
        </div>
        <button className="btn btn-secondary" onClick={load}>{tt('Обновить')}</button>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <section className="panel">
        <h2>{tt('Создать пользователя')}</h2>
        <div className="create-grid">
          <input className="text-input" placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          <input className="text-input" placeholder={tt('Username (опционально)')} value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
          <input
            className="text-input"
            placeholder={tt('Пароль (>=6)')}
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <label className="checkbox-line">
            <input type="checkbox" checked={newIsAdmin} onChange={(e) => setNewIsAdmin(e.target.checked)} />
            {tt('Администратор')}
          </label>
        </div>
        <div>
          <button className="btn" onClick={createUser}>{tt('Создать')}</button>
        </div>
      </section>

      <section className="panel">
        <h2>{tt('Пользователи')}</h2>

        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>{tt('Пользователь')}</th>
                <th>{tt('Аватар')}</th>
                <th>{tt('Дата создания')}</th>
                <th>Email</th>
                <th>{tt('Админ')}</th>
                <th>{tt('Сброс пароля')}</th>
                <th>{tt('Действия')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input className="text-input" value={r.username} onChange={(e) => updateRow(r.id, { username: e.target.value })} />
                    <div className="muted">ID: {r.id}</div>
                  </td>
                  <td className="avatar-cell">
                    <div className="avatar-box">
                      {r.avatarPath ? (
                        <img className="avatar-preview" src={r.avatarPath} alt={`${tt('Аватар')} ${r.username}`} />
                      ) : (
                        <span className="avatar-preview avatar-fallback">{(r.username || 'U').slice(0, 1).toUpperCase()}</span>
                      )}
                      <label className={`btn btn-secondary btn-file${r.deletedAt ? ' btn-disabled' : ''}`}>
                        {r.uploadingAvatar ? tt('Загрузка...') : tt('Изменить')}
                        <input
                          type="file"
                          accept="image/*"
                          disabled={!!r.uploadingAvatar || !!r.deletedAt}
                          onChange={(e) => {
                            const f = e.currentTarget.files?.[0];
                            e.currentTarget.value = '';
                            if (f) void uploadAvatar(r, f);
                          }}
                        />
                      </label>
                    </div>
                  </td>
                  <td>{fmtDate(r.createdAt, localeTag)}</td>
                  <td>
                    <input className="text-input" value={r.email} onChange={(e) => updateRow(r.id, { email: e.target.value })} />
                  </td>
                  <td>
                    <label className="checkbox-line">
                      <input type="checkbox" checked={r.isAdmin} onChange={(e) => updateRow(r.id, { isAdmin: e.target.checked })} />
                      {r.isAdmin ? tt('Да') : tt('Нет')}
                    </label>
                  </td>
                  <td>
                    <button className="btn btn-secondary" disabled={!!r.sendingReset || !!r.deletedAt} onClick={() => sendReset(r)}>
                      {r.sendingReset ? tt('Отправка...') : tt('Сбросить пароль')}
                    </button>
                  </td>
                  <td>
                    <div className="actions-cell">
                      <button className="btn" disabled={!r.dirty || !!r.saving} onClick={() => saveRow(r)}>
                        {r.saving ? tt('Сохранение...') : tt('Сохранить')}
                      </button>
                      {r.deletedAt ? (
                        <button className="btn btn-secondary" onClick={() => restoreRow(r.id)}>{tt('Восстановить')}</button>
                      ) : (
                        <button className="btn btn-danger" onClick={() => deleteRow(r.id)}>{tt('Удалить')}</button>
                      )}
                    </div>
                    <div className="muted">{r.deletedAt ? `${tt('Удален')}: ${fmtDate(r.deletedAt, localeTag)}` : tt('Активен')}</div>
                  </td>
                </tr>
              ))}

              {!sorted.length ? (
                <tr>
                  <td colSpan={7} className="empty-row">{tt('Пользователей нет.')}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <style jsx>{`
        .admin-users-wrap {
          max-width: 1200px;
          margin: 0 auto;
          padding: 16px;
          display: grid;
          gap: 16px;
        }
        .admin-users-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        h2 {
          margin: 0;
          font-size: 18px;
        }
        p {
          margin: 0;
          color: #4b5563;
        }
        .panel {
          border: 1px solid #d1d5db;
          border-radius: 14px;
          padding: 14px;
          display: grid;
          gap: 12px;
          background: #fff;
        }
        .error-box {
          border: 1px solid #fecaca;
          background: #fef2f2;
          color: #991b1b;
          border-radius: 10px;
          padding: 10px;
        }
        .create-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .text-input {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 10px;
          padding: 9px 10px;
          font-size: 14px;
        }
        .btn {
          border: 1px solid #2563eb;
          background: #2563eb;
          color: #fff;
          border-radius: 10px;
          padding: 8px 12px;
          cursor: pointer;
          font-weight: 700;
        }
        .btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .btn-secondary {
          border-color: #d1d5db;
          background: #fff;
          color: #111827;
        }
        .btn-danger {
          border-color: #ef4444;
          background: #fff;
          color: #b91c1c;
        }
        .users-table-wrap {
          overflow-x: auto;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
        }
        .users-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 1220px;
        }
        th, td {
          border-bottom: 1px solid #e5e7eb;
          padding: 10px;
          text-align: left;
          vertical-align: top;
        }
        th {
          background: #f9fafb;
          font-size: 13px;
          font-weight: 700;
          white-space: nowrap;
        }
        td {
          font-size: 14px;
        }
        .avatar-cell {
          min-width: 190px;
        }
        .avatar-box {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .avatar-preview {
          width: 42px;
          height: 42px;
          border-radius: 999px;
          object-fit: cover;
          border: 1px solid #e5e7eb;
          flex: 0 0 auto;
          background: #fff;
        }
        .avatar-fallback {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          color: #374151;
          background: #f3f4f6;
        }
        .btn-file {
          position: relative;
          overflow: hidden;
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
        .actions-cell {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 8px;
        }
        .muted {
          font-size: 12px;
          color: #6b7280;
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
        }
        @media (max-width: 1024px) {
          .create-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
