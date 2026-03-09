'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/auth/provider';
import Link from 'next/link';
import LanguageSelect from '@/components/LanguageSelect';
import { type Locale, normalizeLocale } from '@/i18n/locale';
import { useI18n } from '@/i18n/provider';

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

  useEffect(() => {
    setLanguage(locale);
  }, [locale]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

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
  };

  return (
    <div style={{ maxWidth: 400, margin: '40px auto' }}>
      <form onSubmit={handleSubmit}>
        <div>
          <label>{messages.auth.login.username}</label>
          <input value={username} onChange={e => setUsername(e.target.value)} />
        </div>
        <div>
          <label>{messages.auth.login.password}</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <LanguageSelect
            value={language}
            onChange={(nextLocale) => {
              setLanguage(nextLocale);
              setLocale(nextLocale);
            }}
            label={messages.common.language}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <Link href="/forgot-password">{messages.auth.login.forgotPassword}</Link>
        </div>
        <button type="submit">{messages.auth.login.submit}</button>
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={() => router.push("/register")}>{messages.auth.login.register}</button>
        </div>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
