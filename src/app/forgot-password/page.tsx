'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useI18n } from '@/i18n/provider';
import { t } from '@/i18n/translate';
import styles from '../login/login.module.css';

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
    <main className={styles.page}>
      <div className={styles.logoBackdrop} aria-hidden="true" />
      <div className={styles.glow} aria-hidden="true" />

      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.brandBadge}>{tt('Восстановление доступа')}</div>
          <h1 className={styles.title}>{tt('Сброс пароля')}</h1>
          <p className={styles.subtitle}>{tt('Введите email из профиля, мы отправим ссылку для смены пароля.')}</p>
          <div className={styles.heroLogoWrap}>
            <Image
              src="/icons/icon-512.png"
              alt="Pushup Tracker"
              width={180}
              height={180}
              priority
              className={styles.heroLogo}
            />
          </div>
        </section>

        <section className={styles.card}>
          <form onSubmit={submit} className={styles.form}>
            <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
              className={styles.input}
        />
            <button
          type="submit"
          disabled={sending}
              className={styles.primaryButton}
        >
          {sending ? tt('Отправка...') : tt('Отправить ссылку')}
        </button>
            {error ? <p className={styles.error}>{error}</p> : null}
            {message ? <p style={successStyle}>{message}</p> : null}
            <Link href="/login" className={styles.inlineLink}>{tt('Назад ко входу')}</Link>
          </form>
        </section>
      </div>
    </main>
  );
}

const successStyle: React.CSSProperties = {
  margin: 0,
  padding: '14px 16px',
  borderRadius: 18,
  background: 'rgba(220, 252, 231, 0.92)',
  border: '1px solid rgba(34, 197, 94, 0.24)',
  color: '#166534',
  fontSize: 14,
  fontWeight: 700,
};
