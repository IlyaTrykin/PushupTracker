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

type RowState = UserRow & { dirty?: boolean; saving?: boolean };

export default function AdminUsersClient() {
  const [rows, setRows] = useState<RowState[]>([]);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  const [newEmail, setNewEmail] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.email.localeCompare(b.email)),
    [rows]
  );

  async function load() {
    setLoading(true);
    setError('');
    const res = await fetch('/api/admin/users', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Ошибка загрузки');
      setRows([]);
    } else {
      setRows((data.users || []).map((u: UserRow) => ({ ...u, dirty: false, saving: false })));
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function updateRow(id: string, patch: Partial<UserRow>) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch, dirty: true } : r))
    );
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

  if (loading) return <div className="p-4">Загрузка...</div>;

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Админка: пользователи</h1>
          <div className="text-sm text-gray-600">Управление учётными записями</div>
        </div>
        <button className="border px-3 py-2 rounded" onClick={load}>
          Обновить
        </button>
      </div>

      {error && <div className="text-red-600">{error}</div>}

      <div className="border rounded p-3 space-y-3">
        <div className="font-semibold">Создать пользователя</div>
        <div className="grid gap-2 max-w-2xl">
          <div className="grid md:grid-cols-2 gap-2">
            <input className="border p-2 rounded" placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <input className="border p-2 rounded" placeholder="Username (можно пусто)" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            <input className="border p-2 rounded" placeholder="Пароль (>=6)" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <label className="flex items-center gap-2 border rounded p-2">
              <input type="checkbox" checked={newIsAdmin} onChange={(e) => setNewIsAdmin(e.target.checked)} />
              Администратор
            </label>
          </div>
          <div>
            <button className="border px-3 py-2 rounded" onClick={createUser}>
              Создать
            </button>
          </div>
        </div>
      </div>

      <div className="border rounded overflow-hidden">
        <div className="px-3 py-2 font-semibold border-b">Пользователи</div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="p-2 border-b">Email</th>
                <th className="p-2 border-b">Username</th>
                <th className="p-2 border-b">Админ</th>
                <th className="p-2 border-b">Статус</th>
                <th className="p-2 border-b">Действия</th>
              </tr>
            </thead>

            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="p-2 border-b">
                    <div className="text-xs text-gray-500 font-mono mb-1">{r.id}</div>
                    <input
                      className="border p-2 rounded w-80 max-w-full"
                      value={r.email}
                      onChange={(e) => updateRow(r.id, { email: e.target.value })}
                    />
                  </td>

                  <td className="p-2 border-b">
                    <input
                      className="border p-2 rounded w-56 max-w-full"
                      value={r.username}
                      onChange={(e) => updateRow(r.id, { username: e.target.value })}
                    />
                  </td>

                  <td className="p-2 border-b">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={r.isAdmin}
                        onChange={(e) => updateRow(r.id, { isAdmin: e.target.checked })}
                      />
                      <span>{r.isAdmin ? 'Да' : 'Нет'}</span>
                    </label>
                  </td>

                  <td className="p-2 border-b">
                    {r.deletedAt ? (
                      <div>
                        <div className="text-red-600 font-semibold">Удалён</div>
                        <div className="text-xs text-gray-500">{new Date(r.deletedAt).toLocaleString()}</div>
                      </div>
                    ) : (
                      <div className="text-green-700 font-semibold">Активен</div>
                    )}
                  </td>

                  <td className="p-2 border-b">
                    <div className="flex gap-2">
                      <button
                        className="border px-3 py-2 rounded disabled:opacity-50"
                        disabled={!r.dirty || r.saving}
                        onClick={() => saveRow(r)}
                      >
                        {r.saving ? 'Сохранение…' : 'Сохранить'}
                      </button>

                      {r.deletedAt ? (
                        <button className="border px-3 py-2 rounded" onClick={() => restoreRow(r.id)}>
                          Восстановить
                        </button>
                      ) : (
                        <button className="border px-3 py-2 rounded text-red-600" onClick={() => deleteRow(r.id)}>
                          Удалить
                        </button>
                      )}
                    </div>

                    {r.dirty ? (
                      <div className="text-xs text-gray-500 mt-1">Есть несохранённые изменения</div>
                    ) : null}
                  </td>
                </tr>
              ))}

              {sorted.length === 0 && (
                <tr>
                  <td className="p-3 text-gray-600" colSpan={5}>
                    Пользователей нет.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-sm text-gray-600">
        URL: <span className="font-mono">/admin/users</span>
      </div>
    </div>
  );
}
