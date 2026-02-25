'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState('');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const current = new URLSearchParams(window.location.search).get('token') || '';
    setToken(current.trim());
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!token) {
      setError('Некорректная ссылка: отсутствует токен');
      return;
    }
    if (password.length < 6) {
      setError('Пароль должен быть не меньше 6 символов');
      return;
    }
    if (password !== confirm) {
      setError('Подтверждение пароля не совпадает');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Не удалось сменить пароль');
      } else {
        setMessage('Пароль успешно обновлён. Сейчас перенаправим на вход.');
        setTimeout(() => router.push('/login'), 1200);
      }
    } catch {
      setError('Ошибка сети');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '40px auto', padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>Новый пароль</h1>

      <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
        <input
          type="password"
          placeholder="Новый пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
        />
        <input
          type="password"
          placeholder="Подтвердите пароль"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
        />
        <button
          type="submit"
          disabled={saving}
          style={{ padding: '10px 12px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 800 }}
        >
          {saving ? 'Сохранение...' : 'Сменить пароль'}
        </button>
      </form>

      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      {message ? <p style={{ color: '#065f46' }}>{message}</p> : null}
    </div>
  );
}
