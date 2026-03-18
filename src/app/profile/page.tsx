'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/provider';
import PushNotificationsToggle from '@/components/PushNotificationsToggle';
import { useI18n } from '@/i18n/provider';

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
  const { setUser } = useAuth();
  const { messages } = useI18n();
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

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/profile', { cache: 'no-store', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProfile(null);
        setUser(null);
        setError(data.error || messages.profile.errors.load);
      } else {
        const nextProfile = data as Profile;
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
      }
    } catch {
      setError(messages.profile.errors.network);
    } finally {
      setLoading(false);
    }
  }, [messages.profile.errors.load, messages.profile.errors.network, setUser]);

  useEffect(() => {
    void load();
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

  if (loading) return <div style={{ padding: 16 }}>{messages.common.loading}</div>;

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>
      {error ? (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 10, marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 999,
            background: '#e5e7eb',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 900,
            color: '#111827',
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
              display: 'inline-block',
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid #d1d5db',
              background: '#fff',
              cursor: uploading ? 'not-allowed' : 'pointer',
              opacity: uploading ? 0.6 : 1,
              fontWeight: 800,
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

      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontWeight: 800 }}>{messages.profile.fields.username}</div>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
          />
          <div style={{ fontSize: 12, color: '#6b7280' }}>{messages.profile.fields.usernameHint}</div>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontWeight: 800 }}>{messages.profile.fields.gender}</div>
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
          >
            <option value="">{messages.profile.fields.notSpecified}</option>
            <option value="male">{messages.profile.fields.male}</option>
            <option value="female">{messages.profile.fields.female}</option>
            <option value="other">{messages.profile.fields.other}</option>
          </select>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontWeight: 800 }}>{messages.profile.fields.birthDate}</div>
          <input
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
          />
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontWeight: 800 }}>{messages.profile.fields.weightKg}</div>
          <input
            type="number"
            min={30}
            max={250}
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              fontWeight: 900,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? messages.common.saving : messages.common.save}
          </button>
        </div>

        <div style={{ marginTop: 20, borderTop: '1px solid #e5e7eb', paddingTop: 16, display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>{messages.profile.sections.password}</div>
          <input
            type="password"
            placeholder={messages.profile.password.current}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
          />
          <input
            type="password"
            placeholder={messages.profile.password.next}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
          />
          <input
            type="password"
            placeholder={messages.profile.password.confirm}
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
          />
          <div>
            <button
              type="button"
              onClick={changePassword}
              disabled={changingPassword}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #1d4ed8',
                background: '#fff',
                color: '#1d4ed8',
                fontWeight: 900,
                cursor: changingPassword ? 'not-allowed' : 'pointer',
                opacity: changingPassword ? 0.6 : 1,
              }}
            >
              {changingPassword ? messages.profile.password.submitting : messages.profile.password.submit}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 20, borderTop: '1px solid #e5e7eb', paddingTop: 16, display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>{messages.profile.sections.notifications}</div>
          <div style={{ fontSize: 13, color: '#4b5563' }}>
            {messages.profile.notifications.summary}
          </div>
          {profile?.isAdmin ? (
            <div style={{ fontSize: 13, color: '#4b5563' }}>
              {messages.profile.notifications.adminSummary}
            </div>
          ) : null}
          <PushNotificationsToggle />
        </div>

        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={deleteProfile}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid #ef4444',
              background: '#fff',
              color: '#b91c1c',
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            {messages.profile.delete.button}
          </button>
        </div>
      </div>
    </div>
  );
}
