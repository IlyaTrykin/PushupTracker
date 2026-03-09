'use client';

import React, { useEffect, useMemo, useState } from 'react';
import PushNotificationsToggle from '@/components/PushNotificationsToggle';

type Profile = {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
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

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/profile', { cache: 'no-store', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProfile(null);
        setError(data.error || 'Не удалось загрузить профиль');
      } else {
        setProfile(data as Profile);
        setUsername((data as Profile).username || '');
        setGender(((data as Profile).gender as any) || '');
        setBirthDate(toDateInputValue((data as Profile).birthDate));
        setWeightKg((data as Profile).weightKg != null ? String((data as Profile).weightKg) : '');
      }
    } catch {
      setError('Не удалось связаться с сервером');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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
        setError(data.error || 'Ошибка сохранения');
      } else {
        await load();
      }
    } catch {
      setError('Не удалось связаться с сервером');
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
        setError('Аватар получился слишком большой. Возьми картинку попроще (или меньше деталей).');
        return;
      }

      const form = new FormData();
      form.append('file', new File([blob], 'avatar.webp', { type: 'image/webp' }));
      const res = await fetch('/api/profile/avatar', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Ошибка загрузки аватара');
      } else {
        await load();
      }
    } catch {
      setError('Не удалось обработать изображение');
    } finally {
      setUploading(false);
    }
  }

  async function deleteProfile() {
    if (!confirm('Удалить профиль? Его можно будет восстановить администратором в течение 1 года.')) return;
    setError('');
    try {
      const res = await fetch('/api/profile', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Не удалось удалить профиль');
      } else {
        window.location.href = '/login';
      }
    } catch {
      setError('Не удалось связаться с сервером');
    }
  }

  async function changePassword() {
    setError('');
    if (!currentPassword) {
      setError('Введите текущий пароль');
      return;
    }
    if (newPassword.length < 6) {
      setError('Новый пароль должен быть не меньше 6 символов');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('Подтверждение пароля не совпадает');
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
        setError(data.error || 'Не удалось изменить пароль');
      } else {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
      }
    } catch {
      setError('Не удалось связаться с сервером');
    } finally {
      setChangingPassword(false);
    }
  }

  if (loading) return <div style={{ padding: 16 }}>Загрузка…</div>;

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
          <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 4 }}>Аватар</div>
          <div style={{ fontSize: 12, color: '#374151', marginBottom: 8 }}>
            Автоматически приводим к 256×256 и WebP. Лимит: 300KB.
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
            {uploading ? 'Загрузка…' : 'Загрузить'}
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
          <div style={{ fontWeight: 800 }}>Имя (username)</div>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
          />
          <div style={{ fontSize: 12, color: '#6b7280' }}>Только латиница, цифры и ._- (до 32 символов).</div>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontWeight: 800 }}>Пол</div>
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
          >
            <option value="">Не указано</option>
            <option value="male">Мужской</option>
            <option value="female">Женский</option>
            <option value="other">Другое</option>
          </select>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontWeight: 800 }}>Дата рождения</div>
          <input
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
          />
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontWeight: 800 }}>Вес (кг)</div>
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
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>

        <div style={{ marginTop: 20, borderTop: '1px solid #e5e7eb', paddingTop: 16, display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Смена пароля</div>
          <input
            type="password"
            placeholder="Текущий пароль"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
          />
          <input
            type="password"
            placeholder="Новый пароль"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
          />
          <input
            type="password"
            placeholder="Подтвердите новый пароль"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db' }}
          />
          <div>
            <button
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
              {changingPassword ? 'Изменение…' : 'Сменить пароль'}
            </button>
        </div>

        <div style={{ marginTop: 20, borderTop: '1px solid #e5e7eb', paddingTop: 16, display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Push уведомления</div>
          <div style={{ fontSize: 13, color: '#4b5563' }}>
            События: запросы в друзья, приглашения, изменения в соревнованиях, тренировки друзей и уведомления программы.
          </div>
          {profile?.isAdmin ? (
            <div style={{ fontSize: 13, color: '#4b5563' }}>
              Для админа здесь также доступны push и e-mail уведомления о новых регистрациях пользователей.
            </div>
          ) : null}
          <PushNotificationsToggle />
        </div>

          <button
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
            Удалить профиль
          </button>
        </div>
      </div>
    </div>
  );
}
