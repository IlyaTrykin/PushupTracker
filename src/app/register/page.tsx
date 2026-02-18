'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password }),
      });

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        // если ответ не JSON — всё равно покажем что-то
      }

      if (!res.ok) {
        const base = data?.error || `Ошибка регистрации (код ${res.status})`;
        const msg = data?.details ? `${base}: ${data.details}` : base;
        setError(msg);
      } else {
        setSuccess(true);
        setTimeout(() => router.push('/login'), 1000);
      }

    } catch (err) {
      console.error('Register error:', err);
      setError('Не удалось связаться с сервером');
    }
  };

  return (
    <div
      style={{
        maxWidth: 400,
        margin: '40px auto',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <h1 style={{ marginBottom: 20 }}>Регистрация</h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label>Email</label>
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label>Ник</label>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label>Пароль</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
          />
        </div>

        {/* ВОТ ОНА, КНОПКА */}
        <button
          type="submit"
          style={{
            marginTop: 12,
            padding: '10px 16px',
            borderRadius: 4,
            border: 'none',
            backgroundColor: '#2563eb',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Зарегистрироваться
        </button>
      </form>

      {error && <p style={{ color: 'red', marginTop: 12 }}>{error}</p>}
      {success && <p style={{ color: 'green', marginTop: 12 }}>Аккаунт создан, сейчас перейдём на вход…</p>}
    </div>
  );
}
