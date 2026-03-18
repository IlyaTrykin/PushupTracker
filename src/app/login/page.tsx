'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/auth/provider';
import Link from 'next/link';
import LanguageSelect from '@/components/LanguageSelect';
import { type Locale, normalizeLocale } from '@/i18n/locale';
import { useI18n } from '@/i18n/provider';
import styles from './login.module.css';

type LoginResponse = {
  ok?: boolean;
  user?: {
    username: string;
    isAdmin?: boolean;
    avatarPath?: string | null;
    language?: string;
  };
  error?: string;
};

export default function LoginPage() {
  const { setUser } = useAuth();
  const { locale, messages, setLocale } = useI18n();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState<Locale>(locale);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setLanguage(locale);
  }, [locale]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      setIsSubmitting(true);
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = (await res.json()) as LoginResponse;
      if (!res.ok) {
        setError(data.error || messages.auth.login.defaultError);
      } else {
        const nextLocale = normalizeLocale(data.user?.language || language);
        setLocale(nextLocale);
        setUser(data.user ? { ...data.user, language: nextLocale } : null);
        window.dispatchEvent(new CustomEvent('authChanged', {
          detail: data.user ? { ...data.user, language: nextLocale } : null,
        }));
        router.replace('/dashboard');
        router.refresh();
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(messages.auth.login.networkError);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.logoBackdrop} aria-hidden="true" />
      <div className={styles.glow} aria-hidden="true" />

      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.brandBadge}>{messages.common.appName}</div>
          <h1 className={styles.title}>{messages.nav.pageTitles.login}</h1>
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
              <label className={styles.label} htmlFor="username">{messages.auth.login.username}</label>
              <input
                id="username"
                className={styles.input}
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="password">{messages.auth.login.password}</label>
              <input
                id="password"
                className={styles.input}
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
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

            <div className={styles.linksRow}>
              <Link className={styles.inlineLink} href="/forgot-password">{messages.auth.login.forgotPassword}</Link>
            </div>

            <button className={styles.primaryButton} type="submit" disabled={isSubmitting}>
              {isSubmitting ? messages.common.loading : messages.auth.login.submit}
            </button>

            <button className={styles.secondaryButton} type="button" onClick={() => router.push('/register')}>
              {messages.auth.login.register}
            </button>

            {error && <p className={styles.error} role="alert">{error}</p>}
          </form>
        </section>
      </div>
    </main>
  );
}
