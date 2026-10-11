'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import LanguageSelect from '@/components/LanguageSelect';
import { type Locale } from '@/i18n/locale';
import { useI18n } from '@/i18n/provider';
import { accountMessages } from '@/i18n/messages/features/account';
import { captureAttribution, clearAttribution, readAttribution } from '@/lib/attribution-client';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validateNewPassword, validateNewUsername } from '@/lib/account-validation';
import styles from '../login/login.module.css';

type JsonObject = Record<string, unknown>;

export default function RegisterPage() {
  const { locale, messages, setLocale } = useI18n();
  const hint = accountMessages[locale];
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState<Locale>(locale);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // /register?invite=<code>&utm_source=… — remember the source until the account is created.
  useEffect(() => {
    captureAttribution();
  }, []);

  useEffect(() => {
    setLanguage(locale);
  }, [locale]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!validateNewUsername(username).ok) {
      setError(hint.usernameInvalid);
      return;
    }
    const passwordCheck = validateNewPassword(password);
    if (!passwordCheck.ok) {
      setError(passwordCheck.code === 'PASSWORD_TOO_LONG' ? hint.passwordTooLong : hint.passwordTooShort);
      return;
    }

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password, language, attribution: readAttribution() }),
      });

      let data: JsonObject = {};
      try {
        const parsed = await res.json();
        data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
      } catch {
        // если ответ не JSON — всё равно покажем что-то
      }

      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : `${messages.auth.register.defaultError} (${res.status})`);
      } else {
        clearAttribution();
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
              <label className={styles.label} htmlFor="register-email">{messages.auth.register.email}</label>
              <input
                id="register-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                autoCapitalize="none"
                maxLength={254}
                required
                className={styles.input}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="register-username">{messages.auth.register.username}</label>
              <input
                id="register-username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                minLength={3}
                maxLength={32}
                required
                aria-describedby="register-username-hint"
                className={styles.input}
              />
              <span id="register-username-hint" style={hintStyle}>{hint.usernameHint}</span>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="register-password">{messages.auth.register.password}</label>
              <input
                id="register-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                required
                aria-describedby="register-password-hint"
                className={styles.input}
              />
              <span id="register-password-hint" style={hintStyle}>{hint.passwordHint}</span>
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

const hintStyle: React.CSSProperties = {
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
