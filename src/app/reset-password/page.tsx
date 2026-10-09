'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/provider';
import { t } from '@/i18n/translate';
import styles from '../login/login.module.css';

const PASSWORD_MIN_LENGTH = 8;

const passwordRule = {
  ru: {
    hint: `Не меньше ${PASSWORD_MIN_LENGTH} символов`,
    tooShort: `Пароль должен быть не меньше ${PASSWORD_MIN_LENGTH} символов`,
  },
  en: {
    hint: `At least ${PASSWORD_MIN_LENGTH} characters`,
    tooShort: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  },
} as const;

export default function ResetPasswordPage() {
  const router = useRouter();
  const { locale } = useI18n();
  const tt = (input: string) => t(locale, input);
  const rule = passwordRule[locale] ?? passwordRule.ru;
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
      setError(tt('Некорректная ссылка: отсутствует токен'));
      return;
    }
    if (Array.from(password).length < PASSWORD_MIN_LENGTH) {
      setError(rule.tooShort);
      return;
    }
    if (password !== confirm) {
      setError(tt('Подтверждение пароля не совпадает'));
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
        setError(tt(data.error || 'Не удалось сменить пароль'));
      } else {
        setMessage(tt('Пароль успешно обновлён. Сейчас перенаправим на вход.'));
        setTimeout(() => router.push('/login'), 1200);
      }
    } catch {
      setError(tt('Ошибка сети'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.logoBackdrop} aria-hidden="true" />
      <div className={styles.glow} aria-hidden="true" />

      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.brandBadge}>{tt('Безопасность')}</div>
          <h1 className={styles.title}>{tt('Новый пароль')}</h1>
          <p className={styles.subtitle}>{tt('Задай новый пароль и мы сразу вернём тебя ко входу.')}</p>
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
              type="password"
              placeholder={tt('Новый пароль')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={128}
              aria-describedby="reset-password-hint"
              className={styles.input}
            />
            <span id="reset-password-hint" style={hintStyle}>{rule.hint}</span>
            <input
              type="password"
              placeholder={tt('Подтвердите пароль')}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className={styles.input}
            />
            <button
          type="submit"
          disabled={saving}
              className={styles.primaryButton}
        >
          {saving ? tt('Сохранение...') : tt('Сменить пароль')}
        </button>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            {message ? <p style={successStyle}>{message}</p> : null}
            <Link href="/login" className={styles.inlineLink}>{tt('Назад ко входу')}</Link>
          </form>
        </section>
      </div>
    </main>
  );
}

const hintStyle: React.CSSProperties = {
  marginTop: -6,
  fontSize: 13,
  lineHeight: 1.35,
  color: '#475569',
};

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
