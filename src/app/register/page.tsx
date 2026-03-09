'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LanguageSelect from '@/components/LanguageSelect';
import { type Locale } from '@/i18n/locale';
import { useI18n } from '@/i18n/provider';

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

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        // если ответ не JSON — всё равно покажем что-то
      }

      if (!res.ok) {
        const base = data?.error || `${messages.auth.register.defaultError} (код ${res.status})`;
        const msg = data?.details ? `${base}: ${data.details}` : base;
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
    <div
      style={{
        maxWidth: 400,
        margin: '40px auto',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label>{messages.auth.register.email}</label>
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label>{messages.auth.register.username}</label>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label>{messages.auth.register.password}</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
          />
        </div>

        <LanguageSelect
          value={language}
          onChange={(nextLocale) => {
            setLanguage(nextLocale);
            setLocale(nextLocale);
          }}
          label={messages.common.language}
        />

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
          {messages.auth.register.submit}
        </button>
      </form>

      {error && <p style={{ color: 'red', marginTop: 12 }}>{error}</p>}
      {success && <p style={{ color: 'green', marginTop: 12 }}>{messages.auth.register.success}</p>}
    </div>
  );
}
