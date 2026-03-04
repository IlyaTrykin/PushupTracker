'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Ошибка входа');
    } else {
      router.push('/dashboard');
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '40px auto' }}>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Имя пользователя</label>
          <input value={username} onChange={e => setUsername(e.target.value)} />
        </div>
        <div>
          <label>Пароль</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <Link href="/forgot-password">Забыли пароль?</Link>
        </div>
        <button type="submit">Войти</button>
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={() => router.push("/register")}>Регистрация</button>
        </div>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
