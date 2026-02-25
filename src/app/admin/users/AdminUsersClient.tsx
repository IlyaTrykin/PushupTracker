'use client';

import { useEffect, useMemo, useState } from 'react';

type UserRow = {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
  createdAt?: string;
  deletedAt?: string | null;
};

type RowState = UserRow & { dirty?: boolean; saving?: boolean; sendingReset?: boolean };

function fmtDate(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU');
}

export default function AdminUsersClient() {
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
      setError(data.error || 'Ошибка загрузки');
      setRows([]);
    } else {
      setRows((data.users || []).map((u: UserRow) => ({ ...u, dirty: false, saving: false, sendingReset: false })));
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
      setError(data.error || 'Ошибка создания');
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
      setError(data.error || 'Ошибка сохранения');
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, saving: false } : x)));
      return;
    }

    await load();
  }

  async function deleteRow(id: string) {
    if (!window.confirm('Удалить пользователя?')) return;
    setError('');
    const res = await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Ошибка удаления');
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
      setError(data.error || 'Ошибка восстановления');
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
      setError(data.error || 'Не удалось отправить письмо');
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, sendingReset: false } : x)));
      return;
    }

    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, sendingReset: false } : x)));
    window.alert(`Ссылка для сброса пароля отправлена на ${r.email}`);
  }

  if (loading) return <div style={{ padding: 16 }}>Загрузка...</div>;

  return (
    <div className="admin-users-wrap">
      <div className="admin-users-head">
        <div>
          <h1>Админка: пользователи</h1>
          <p>Управление профилями, правами доступа и паролями.</p>
        </div>
        <button className="btn btn-secondary" onClick={load}>Обновить</button>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <section className="panel">
        <h2>Создать пользователя</h2>
        <div className="create-grid">
          <input placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          <input placeholder="Username (опционально)" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
          <input placeholder="Пароль (>=6)" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <label className="checkbox-line">
            <input type="checkbox" checked={newIsAdmin} onChange={(e) => setNewIsAdmin(e.target.checked)} />
            Администратор
          </label>
        </div>
        <div>
          <button className="btn" onClick={createUser}>Создать</button>
        </div>
      </section>

      <section className="panel">
        <h2>Пользователи</h2>

        <div className="desktop-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>Имя пользователя</th>
                <th>Дата создания</th>
                <th>Email</th>
                <th>Админ</th>
                <th>Сброс пароля</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input value={r.username} onChange={(e) => updateRow(r.id, { username: e.target.value })} />
                    <div className="muted">ID: {r.id}</div>
                  </td>
                  <td>{fmtDate(r.createdAt)}</td>
                  <td>
                    <input value={r.email} onChange={(e) => updateRow(r.id, { email: e.target.value })} />
                  </td>
                  <td>
                    <label className="checkbox-line">
                      <input type="checkbox" checked={r.isAdmin} onChange={(e) => updateRow(r.id, { isAdmin: e.target.checked })} />
                      {r.isAdmin ? 'Да' : 'Нет'}
                    </label>
                  </td>
                  <td>
                    <button className="btn btn-secondary" disabled={!!r.sendingReset || !!r.deletedAt} onClick={() => sendReset(r)}>
                      {r.sendingReset ? 'Отправка...' : 'Сбросить пароль'}
                    </button>
                  </td>
                  <td>
                    <div className="actions-cell">
                      <button className="btn" disabled={!r.dirty || !!r.saving} onClick={() => saveRow(r)}>
                        {r.saving ? 'Сохранение...' : 'Сохранить'}
                      </button>
                      {r.deletedAt ? (
                        <button className="btn btn-secondary" onClick={() => restoreRow(r.id)}>Восстановить</button>
                      ) : (
                        <button className="btn btn-danger" onClick={() => deleteRow(r.id)}>Удалить</button>
                      )}
                    </div>
                    <div className="muted">{r.deletedAt ? `Удален: ${fmtDate(r.deletedAt)}` : 'Активен'}</div>
                  </td>
                </tr>
              ))}

              {!sorted.length ? (
                <tr>
                  <td colSpan={6} className="empty-row">Пользователей нет.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mobile-cards">
          {sorted.map((r) => (
            <article className="user-card" key={`m-${r.id}`}>
              <label>
                Имя пользователя
                <input value={r.username} onChange={(e) => updateRow(r.id, { username: e.target.value })} />
              </label>

              <div className="info-line"><span>Дата создания:</span><strong>{fmtDate(r.createdAt)}</strong></div>

              <label>
                Email
                <input value={r.email} onChange={(e) => updateRow(r.id, { email: e.target.value })} />
              </label>

              <label className="checkbox-line">
                <input type="checkbox" checked={r.isAdmin} onChange={(e) => updateRow(r.id, { isAdmin: e.target.checked })} />
                Администратор
              </label>

              <div className="card-actions">
                <button className="btn btn-secondary" disabled={!!r.sendingReset || !!r.deletedAt} onClick={() => sendReset(r)}>
                  {r.sendingReset ? 'Отправка...' : 'Сбросить пароль'}
                </button>
                <button className="btn" disabled={!r.dirty || !!r.saving} onClick={() => saveRow(r)}>
                  {r.saving ? 'Сохранение...' : 'Сохранить'}
                </button>
                {r.deletedAt ? (
                  <button className="btn btn-secondary" onClick={() => restoreRow(r.id)}>Восстановить</button>
                ) : (
                  <button className="btn btn-danger" onClick={() => deleteRow(r.id)}>Удалить</button>
                )}
              </div>

              <div className="muted">{r.deletedAt ? `Удален: ${fmtDate(r.deletedAt)}` : 'Активен'}</div>
            </article>
          ))}
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
        h1 {
          margin: 0;
          font-size: 24px;
        }
        h2 {
          margin: 0;
          font-size: 18px;
        }
        p {
          margin: 6px 0 0;
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
        input {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 10px;
          padding: 9px 10px;
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
        .desktop-table-wrap {
          overflow: auto;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
        }
        .users-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 980px;
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
        .mobile-cards {
          display: none;
          gap: 10px;
        }
        .user-card {
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 10px;
          display: grid;
          gap: 8px;
        }
        .user-card label {
          display: grid;
          gap: 5px;
          font-size: 13px;
          font-weight: 700;
        }
        .info-line {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          font-size: 13px;
          color: #4b5563;
        }
        .card-actions {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
        }
        @media (max-width: 1024px) {
          .create-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 900px) {
          .desktop-table-wrap {
            display: none;
          }
          .mobile-cards {
            display: grid;
          }
        }
      `}</style>
    </div>
  );
}
