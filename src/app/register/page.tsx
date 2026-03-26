'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import LanguageSelect from '@/components/LanguageSelect';
import { type Locale } from '@/i18n/locale';
import { useI18n } from '@/i18n/provider';
import styles from '../login/login.module.css';

type JsonObject = Record<string, unknown>;

export default function RegisterPage() {
  const { locale, messages, setLocale } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState<Locale>(locale);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setLanguage(locale);
  }, [locale]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password, language }),
      });

      let data: JsonObject = {};
      try {
        const parsed = await res.json();
        data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
      } catch {
        // если ответ не JSON — всё равно покажем что-то
      }

      if (!res.ok) {
        const base = typeof data.error === 'string' ? data.error : `${messages.auth.register.defaultError} (код ${res.status})`;
        const details = typeof data.details === 'string' ? data.details : '';
        const msg = details ? `${base}: ${details}` : base;
        setError(msg);
      } else {
        setLocale(language);
        setSuccess(true);
        setTimeout(() => router.push('/login'), 1000);
      }

    } catch (err) {
      console.error('Register error:', err);
      setError(messages.auth.register.networkError);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.logoBackdrop} aria-hidden="true" />
      <div className={styles.glow} aria-hidden="true" />

      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.brandBadge}>{messages.common.appName}</div>
          <h1 className={styles.title}>{messages.nav.pageTitles.register}</h1>
          <p className={styles.subtitle}>{messages.auth.login.subtitle}</p>
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
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label}>{messages.auth.register.email}</label>
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
                className={styles.input}
          />
        </div>

            <div className={styles.field}>
              <label className={styles.label}>{messages.auth.register.username}</label>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
                className={styles.input}
          />
        </div>

            <div className={styles.field}>
              <label className={styles.label}>{messages.auth.register.password}</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
                className={styles.input}
          />
        </div>

            <LanguageSelect
          value={language}
          onChange={(nextLocale) => {
            setLanguage(nextLocale);
            setLocale(nextLocale);
          }}
          label={messages.common.language}
              containerStyle={{ gap: 8 }}
              labelStyle={{ color: '#0f172a', fontSize: 14 }}
              selectStyle={{
                width: '100%',
                minHeight: 56,
                padding: '0 18px',
                borderRadius: 18,
                border: '1px solid rgba(148, 163, 184, 0.45)',
                background: 'rgba(255, 255, 255, 0.9)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.6)',
              }}
        />

            <button type="submit" className={styles.primaryButton}>
              {messages.auth.register.submit}
            </button>

            <Link href="/login" className={styles.secondaryButton} style={{ textDecoration: 'none', display: 'inline-flex' }}>
              {messages.nav.pageTitles.login}
            </Link>

            {error && <p className={styles.error} role="alert">{error}</p>}
            {success && <p style={{ ...successStyle }}>{messages.auth.register.success}</p>}
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
