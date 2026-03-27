'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/provider';
import PushNotificationsToggle from '@/components/PushNotificationsToggle';
import { useI18n } from '@/i18n/provider';
import { getUserScopedCacheKey, readCachedValue, writeCachedValue } from '@/lib/client-cache';

type Profile = {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
  language: string;
  createdAt: string;
  updatedAt: string;
  gender: string | null;
  birthDate: string | null;
  weightKg: number | null;
  avatarPath: string | null;
};

function toDateInputValue(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

async function resizeToWebp256(file: File): Promise<Blob> {
  // Client-side standardization: 256x256 crop + webp encode.
  const img = document.createElement('img');
  img.decoding = 'async';
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('LOAD_ERROR'));
      img.src = url;
    });

    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('NO_CTX');

    // crop to square (center)
    const sw = img.naturalWidth;
    const sh = img.naturalHeight;
    const s = Math.min(sw, sh);
    const sx = Math.floor((sw - s) / 2);
    const sy = Math.floor((sh - s) / 2);

    ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('BLOB_ERROR'))),
        'image/webp',
        0.82,
      );
    });

    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const { messages } = useI18n();
  const cacheKey = useMemo(() => getUserScopedCacheKey('profile', user?.id, user?.username), [user?.id, user?.username]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState('');
  const [gender, setGender] = useState<string>('');
  const [birthDate, setBirthDate] = useState('');
  const [weightKg, setWeightKg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const avatarUrl = useMemo(() => {
    const p = profile?.avatarPath || '';
    return p ? p : '';
  }, [profile?.avatarPath]);

  const applyProfile = useCallback((nextProfile: Profile) => {
    setProfile(nextProfile);
    setUser({
      id: nextProfile.id,
      email: nextProfile.email,
      username: nextProfile.username,
      isAdmin: nextProfile.isAdmin,
      avatarPath: nextProfile.avatarPath,
      language: nextProfile.language,
    });
    setUsername(nextProfile.username || '');
    setGender(nextProfile.gender || '');
    setBirthDate(toDateInputValue(nextProfile.birthDate));
    setWeightKg(nextProfile.weightKg != null ? String(nextProfile.weightKg) : '');
  }, [setUser]);

  const load = useCallback(async ({ preferCache = false }: { preferCache?: boolean } = {}) => {
    const cached = preferCache ? readCachedValue<Profile>(cacheKey) : null;
    setLoading(!cached);
    setError('');
    if (cached) applyProfile(cached);
    try {
      const res = await fetch('/api/profile', { cache: 'no-store', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (!cached) {
          setProfile(null);
          setUser(null);
          setError(data.error || messages.profile.errors.load);
        }
      } else {
        const nextProfile = data as Profile;
        applyProfile(nextProfile);
        writeCachedValue(cacheKey, nextProfile);
      }
    } catch {
      if (!cached) setError(messages.profile.errors.network);
    } finally {
      setLoading(false);
    }
  }, [applyProfile, cacheKey, messages.profile.errors.load, messages.profile.errors.network, setUser]);

  useEffect(() => {
    void load({ preferCache: true });
  }, [load]);

  async function save() {
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          gender: gender || null,
          birthDate: birthDate || null,
          weightKg: weightKg ? Number(weightKg) : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || messages.profile.errors.save);
      } else {
        if (data.user) {
          setUser({
            id: data.user.id,
            email: data.user.email,
            username: data.user.username,
            isAdmin: data.user.isAdmin,
            avatarPath: data.user.avatarPath,
            language: data.user.language,
          });
        }
        await load();
      }
    } catch {
      setError(messages.profile.errors.network);
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    setError('');
    setUploading(true);
    try {
      const blob = await resizeToWebp256(file);
      if (blob.size > 300_000) {
        setError(messages.profile.errors.avatarTooLarge);
        return;
      }

      const form = new FormData();
      form.append('file', new File([blob], 'avatar.webp', { type: 'image/webp' }));
      const res = await fetch('/api/profile/avatar', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || messages.profile.errors.avatarUpload);
      } else {
        await load();
      }
    } catch {
      setError(messages.profile.errors.avatarProcess);
    } finally {
      setUploading(false);
    }
  }

  async function deleteProfile() {
    if (!confirm(messages.profile.delete.confirm)) return;
    setError('');
    try {
      const res = await fetch('/api/profile', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || messages.profile.errors.delete);
      } else {
        window.location.href = '/login';
      }
    } catch {
      setError(messages.profile.errors.network);
    }
  }

  async function changePassword() {
    setError('');
    if (!currentPassword) {
      setError(messages.profile.password.missingCurrent);
      return;
    }
    if (newPassword.length < 6) {
      setError(messages.profile.password.minLength);
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError(messages.profile.password.mismatch);
      return;
    }

    setChangingPassword(true);
    try {
      const res = await fetch('/api/profile/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || messages.profile.errors.changePassword);
      } else {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
      }
    } catch {
      setError(messages.profile.errors.network);
    } finally {
      setChangingPassword(false);
    }
  }

  if (loading) return <div style={{ padding: 16, color: '#475569' }}>{messages.common.loading}</div>;

  return (
    <div className="app-page" style={profilePage}>
      {error ? (
        <div style={errorBox}>
          {error}
        </div>
      ) : null}

      <section style={heroCard}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div
            style={{
              ...avatarCircle,
              width: 84,
              height: 84,
              fontSize: 28,
            }}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span>{(profile?.username || 'U').slice(0, 1).toUpperCase()}</span>
            )}
          </div>

          <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
            <div style={eyebrow}>{messages.nav.pageTitles.profile}</div>
            <h1 style={heroTitle}>{profile?.username || messages.profile.fields.username}</h1>
            <div style={heroMeta}>{profile?.email}</div>
          </div>
        </div>
      </section>

      <section style={panelCard}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div
          style={{
            ...avatarCircle,
            width: 72,
            height: 72,
          }}
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span>{(profile?.username || 'U').slice(0, 1).toUpperCase()}</span>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 4 }}>{messages.profile.avatar.title}</div>
          <div style={{ fontSize: 12, color: '#374151', marginBottom: 8 }}>
            {messages.profile.avatar.hint}
          </div>
          <label
            style={{
              ...buttonSecondary,
              display: 'inline-block',
              cursor: uploading ? 'not-allowed' : 'pointer',
              opacity: uploading ? 0.6 : 1,
            }}
          >
            {uploading ? messages.profile.avatar.uploading : messages.profile.avatar.upload}
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAvatar(f);
                e.currentTarget.value = '';
              }}
            />
          </label>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={fieldLabel}>{messages.profile.fields.username}</div>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={fieldInput}
          />
          <div style={fieldHint}>{messages.profile.fields.usernameHint}</div>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div style={fieldLabel}>{messages.profile.fields.gender}</div>
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            style={fieldInput}
          >
            <option value="">{messages.profile.fields.notSpecified}</option>
            <option value="male">{messages.profile.fields.male}</option>
            <option value="female">{messages.profile.fields.female}</option>
            <option value="other">{messages.profile.fields.other}</option>
          </select>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div style={fieldLabel}>{messages.profile.fields.birthDate}</div>
          <input
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            style={fieldInput}
          />
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div style={fieldLabel}>{messages.profile.fields.weightKg}</div>
          <input
            type="number"
            min={30}
            max={250}
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            style={fieldInput}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          <button
            onClick={save}
            disabled={saving}
            style={{ ...buttonPrimary, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? messages.common.saving : messages.common.save}
          </button>
        </div>
      </div>
      </section>

      <section style={panelCard}>
        <div style={sectionTitle}>{messages.profile.sections.password}</div>
        <div style={{ display: 'grid', gap: 10 }}>
          <input
            type="password"
            placeholder={messages.profile.password.current}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            style={fieldInput}
          />
          <input
            type="password"
            placeholder={messages.profile.password.next}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={fieldInput}
          />
          <input
            type="password"
            placeholder={messages.profile.password.confirm}
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            style={fieldInput}
          />
          <div>
            <button
              type="button"
              onClick={changePassword}
              disabled={changingPassword}
              style={{ ...buttonSecondary, cursor: changingPassword ? 'not-allowed' : 'pointer', opacity: changingPassword ? 0.6 : 1 }}
            >
              {changingPassword ? messages.profile.password.submitting : messages.profile.password.submit}
            </button>
          </div>
        </div>
      </section>

      <section style={panelCard}>
        <div style={sectionTitle}>{messages.profile.sections.notifications}</div>
        <div style={fieldHint}>
            {messages.profile.notifications.summary}
        </div>
        {profile?.isAdmin ? (
          <div style={fieldHint}>
            {messages.profile.notifications.adminSummary}
          </div>
        ) : null}
        <PushNotificationsToggle />
      </section>

      <section style={dangerCard}>
        <div style={sectionTitle}>{messages.profile.delete.button}</div>
        <div style={fieldHint}>{messages.profile.delete.confirm}</div>
        <div>
          <button
            type="button"
            onClick={deleteProfile}
            style={buttonDanger}
          >
            {messages.profile.delete.button}
          </button>
        </div>
      </section>
    </div>
  );
}

const profilePage: React.CSSProperties = {
  maxWidth: 860,
  display: 'grid',
  gap: 18,
};

const heroCard: React.CSSProperties = {
  display: 'grid',
  gap: 14,
  padding: 'clamp(18px, 3vw, 28px)',
  borderRadius: 30,
  border: '1px solid rgba(251, 146, 60, 0.24)',
  background:
    'radial-gradient(circle at top right, rgba(251, 146, 60, 0.16), transparent 28%), linear-gradient(145deg, rgba(255, 250, 243, 0.96) 0%, rgba(255, 255, 255, 0.92) 54%, rgba(239, 246, 255, 0.9) 100%)',
  boxShadow: '0 28px 80px rgba(15, 23, 42, 0.12)',
};

const panelCard: React.CSSProperties = {
  display: 'grid',
  gap: 16,
  padding: 'clamp(18px, 3vw, 24px)',
  borderRadius: 28,
  border: '1px solid rgba(255, 255, 255, 0.86)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(248, 250, 252, 0.88) 100%)',
  boxShadow: '0 20px 52px rgba(15, 23, 42, 0.08)',
};

const dangerCard: React.CSSProperties = {
  ...panelCard,
  border: '1px solid rgba(248, 113, 113, 0.26)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(254, 242, 242, 0.88) 100%)',
};

const avatarCircle: React.CSSProperties = {
  borderRadius: 999,
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.88) 0%, rgba(226, 232, 240, 0.92) 100%)',
  border: '1px solid rgba(255, 255, 255, 0.86)',
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 900,
  color: '#111827',
  boxShadow: '0 16px 34px rgba(15, 23, 42, 0.1)',
};

const eyebrow: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#c2410c',
};

const heroTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 'clamp(28px, 4vw, 40px)',
  lineHeight: 0.98,
  fontWeight: 900,
  letterSpacing: '-0.05em',
  color: '#0f172a',
};

const heroMeta: React.CSSProperties = {
  color: '#475569',
  fontSize: 14,
  fontWeight: 700,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 900,
  color: '#0f172a',
};

const fieldLabel: React.CSSProperties = {
  fontWeight: 800,
  color: '#0f172a',
};

const fieldHint: React.CSSProperties = {
  fontSize: 13,
  color: '#64748b',
  lineHeight: 1.5,
};

const fieldInput: React.CSSProperties = {
  width: '100%',
  minHeight: 50,
  padding: '0 14px',
  borderRadius: 16,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(255, 255, 255, 0.88)',
  color: '#0f172a',
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.7)',
};

const buttonPrimary: React.CSSProperties = {
  minHeight: 48,
  padding: '10px 16px',
  borderRadius: 14,
  border: 'none',
  background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
  boxShadow: '0 16px 30px rgba(234, 88, 12, 0.24)',
  color: '#fff',
  fontWeight: 900,
};

const buttonSecondary: React.CSSProperties = {
  minHeight: 48,
  padding: '10px 16px',
  borderRadius: 14,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(255, 255, 255, 0.82)',
  color: '#0f172a',
  fontWeight: 900,
};

const buttonDanger: React.CSSProperties = {
  minHeight: 48,
  padding: '10px 16px',
  borderRadius: 14,
  border: '1px solid rgba(239, 68, 68, 0.22)',
  background: 'rgba(255, 255, 255, 0.86)',
  color: '#b91c1c',
  fontWeight: 900,
  cursor: 'pointer',
};

const errorBox: React.CSSProperties = {
  margin: 0,
  padding: '14px 16px',
  borderRadius: 18,
  background: 'rgba(254, 226, 226, 0.92)',
  border: '1px solid rgba(248, 113, 113, 0.34)',
  color: '#b91c1c',
  fontWeight: 700,
};
