'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/i18n/provider';
import { t } from '@/i18n/translate';

export default function ForgotPasswordPage() {
  const { locale } = useI18n();
  const tt = (input: string) => t(locale, input);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!email.trim()) {
      setError(tt('Введите email'));
      return;
    }

    setSending(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(tt(data.error || 'Не удалось отправить письмо'));
      } else {
        setMessage(tt(data.message || 'Если аккаунт существует, ссылка отправлена на почту.'));
      }
    } catch {
      setError(tt('Ошибка сети'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '40px auto', padding: 16 }}>
      <p style={{ color: '#4b5563' }}>{tt('Введите email из профиля, мы отправим ссылку для смены пароля.')}</p>

      <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
        />
        <button
          type="submit"
          disabled={sending}
          style={{ padding: '10px 12px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 800 }}
        >
          {sending ? tt('Отправка...') : tt('Отправить ссылку')}
        </button>
      </form>

      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      {message ? <p style={{ color: '#065f46' }}>{message}</p> : null}

      <div style={{ marginTop: 12 }}>
        <Link href="/login">{tt('Назад ко входу')}</Link>
      </div>
    </div>
  );
}
