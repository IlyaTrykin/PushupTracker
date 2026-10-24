'use client';

import { useMemo, useState } from 'react';
import LanguageSelect from '@/components/LanguageSelect';
import { useLanguageSwitch } from '@/components/AppNavClient';
import { InfoButton } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { dailyGoalMessages } from '@/i18n/messages/features/daily-goal';
import { profileSectionsMessages } from '@/i18n/messages/features/profile-sections';
import type { Profile } from './sections';
import {
  avatarCircle,
  buttonPrimary,
  buttonSecondary,
  errorBox,
  fieldHint,
  fieldInput,
  fieldLabel,
  fromHealthBadge,
  okText,
  panelCard,
  titleRow,
} from './profile-styles';

function supportedTimeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    zones = intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {}
  let browserZone = '';
  try {
    browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {}
  return Array.from(new Set([current, browserZone, ...zones].filter(Boolean))).sort();
}

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

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('BLOB_ERROR'))), 'image/webp', 0.82);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * «Персональная информация»: аватар, ник, пол, дата рождения, вес и рост (метка «из Health»,
 * если значение пришло из Health), язык и часовой пояс. Сохраняется одной кнопкой; язык — сразу.
 */
export default function PersonalSection({
  profile,
  avatarUrl,
  reload,
}: {
  profile: Profile;
  avatarUrl: string;
  /** Перечитать профиль после сохранения (обновляет и пользователя в шапке). */
  reload: () => Promise<void>;
}) {
  const { locale, messages } = useI18n();
  const text = profileSectionsMessages[locale].personal;
  const goalText = dailyGoalMessages[locale];
  const { change: changeLanguage, updating: updatingLanguage } = useLanguageSwitch();
  const [username, setUsername] = useState(profile.username || '');
  const [gender, setGender] = useState(profile.gender || '');
  const [birthDate, setBirthDate] = useState(toDateInputValue(profile.birthDate));
  const [weightKg, setWeightKg] = useState(profile.weightKg != null ? String(profile.weightKg) : '');
  const [heightCm, setHeightCm] = useState(profile.heightCm != null ? String(profile.heightCm) : '');
  const [timeZone, setTimeZone] = useState(profile.timeZone || '');
  const timeZones = useMemo(() => supportedTimeZones(timeZone), [timeZone]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // Профиль пришёл заново (кэш → сервер, вес из Health, после сохранения): поля, которые не
  // правили руками, следуют за ним; начатая правка остаётся.
  const [base, setBase] = useState(profile);
  if (base !== profile) {
    setBase(profile);
    const follow = (value: string, before: string, after: string, set: (v: string) => void) => {
      if (value === before && before !== after) set(after);
    };
    follow(username, base.username || '', profile.username || '', setUsername);
    follow(gender, base.gender || '', profile.gender || '', setGender);
    follow(birthDate, toDateInputValue(base.birthDate), toDateInputValue(profile.birthDate), setBirthDate);
    follow(weightKg, base.weightKg != null ? String(base.weightKg) : '', profile.weightKg != null ? String(profile.weightKg) : '', setWeightKg);
    follow(heightCm, base.heightCm != null ? String(base.heightCm) : '', profile.heightCm != null ? String(profile.heightCm) : '', setHeightCm);
    follow(timeZone, base.timeZone || '', profile.timeZone || '', setTimeZone);
  }

  // Метка «из Health» — пока в поле значение, которое пришло из Health (правка руками её снимет при сохранении).
  const weightFromHealth = profile.weightSource === 'health' && profile.weightKg != null && weightKg === String(profile.weightKg);
  const heightFromHealth = profile.heightSource === 'health' && profile.heightCm != null && heightCm === String(profile.heightCm);

  const edit = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setSaved(false);
  };

  async function save() {
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          gender: gender || null,
          birthDate: birthDate || null,
          weightKg: weightKg.trim() ? Number(weightKg) : null,
          heightCm: heightCm.trim() ? Number(heightCm) : null,
          ...(timeZone ? { timeZone } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'WEIGHT_INVALID') setError(text.weightInvalid);
        else if (data.code === 'HEIGHT_INVALID') setError(text.heightInvalid);
        else setError(data.error || messages.profile.errors.save);
        return;
      }
      setSaved(true);
      await reload();
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
      if (!res.ok) setError(data.error || messages.profile.errors.avatarUpload);
      else await reload();
    } catch {
      setError(messages.profile.errors.avatarProcess);
    } finally {
      setUploading(false);
    }
  }

  const healthBadge = (
    <span style={titleRow}>
      <span style={fromHealthBadge} data-testid="from-health">{text.fromHealth}</span>
      <InfoButton title={text.fromHealthInfoTitle}>{text.fromHealthInfo}</InfoButton>
    </span>
  );

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={panelCard}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ ...avatarCircle, width: 72, height: 72 }}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span>{(profile.username || 'U').slice(0, 1).toUpperCase()}</span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 8 }}>
            <div style={{ ...titleRow, fontWeight: 900, fontSize: 14 }}>
              {messages.profile.avatar.title}
              <InfoButton title={messages.profile.avatar.title}>{messages.profile.avatar.hint}</InfoButton>
            </div>
            <div>
              <label
                style={{
                  ...buttonSecondary,
                  display: 'inline-flex',
                  alignItems: 'center',
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
                    if (f) void uploadAvatar(f);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ ...fieldLabel, ...titleRow }}>
              {messages.profile.fields.username}
              <InfoButton title={messages.profile.fields.username}>{messages.profile.fields.usernameHint}</InfoButton>
            </span>
            <input value={username} onChange={(e) => edit(setUsername)(e.target.value)} style={fieldInput} autoComplete="username" />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={fieldLabel}>{messages.profile.fields.gender}</span>
            <select value={gender} onChange={(e) => edit(setGender)(e.target.value)} style={fieldInput}>
              <option value="">{messages.profile.fields.notSpecified}</option>
              <option value="male">{messages.profile.fields.male}</option>
              <option value="female">{messages.profile.fields.female}</option>
              <option value="other">{messages.profile.fields.other}</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={fieldLabel}>{messages.profile.fields.birthDate}</span>
            <input type="date" value={birthDate} onChange={(e) => edit(setBirthDate)(e.target.value)} style={fieldInput} />
          </label>

          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ ...titleRow, flexWrap: 'wrap', gap: 8 }}>
              <label htmlFor="profile-weight" style={{ ...fieldLabel, ...titleRow }}>
                {messages.profile.fields.weightKg}
                <InfoButton title={text.bodyInfoTitle}>{text.bodyInfo}</InfoButton>
              </label>
              {weightFromHealth ? healthBadge : null}
            </span>
            <input
              id="profile-weight"
              type="number"
              inputMode="numeric"
              min={30}
              max={250}
              value={weightKg}
              onChange={(e) => edit(setWeightKg)(e.target.value)}
              style={fieldInput}
            />
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ ...titleRow, flexWrap: 'wrap', gap: 8 }}>
              <label htmlFor="profile-height" style={fieldLabel}>
                {text.heightCm}
              </label>
              {heightFromHealth ? healthBadge : null}
            </span>
            <input
              id="profile-height"
              type="number"
              inputMode="numeric"
              min={100}
              max={250}
              value={heightCm}
              onChange={(e) => edit(setHeightCm)(e.target.value)}
              style={fieldInput}
              data-testid="profile-height"
            />
          </div>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ ...fieldLabel, ...titleRow }}>
              {goalText.timeZoneLabel}
              <InfoButton title={text.timeZoneInfoTitle}>{goalText.timeZoneHint}</InfoButton>
            </span>
            <select value={timeZone} onChange={(e) => edit(setTimeZone)(e.target.value)} style={fieldInput}>
              {timeZones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>

          {error ? (
            <div style={errorBox} role="alert">
              {error}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              style={{ ...buttonPrimary, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? messages.common.saving : messages.common.save}
            </button>
            {saved ? (
              <span style={okText} role="status">
                {text.saved}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section style={panelCard}>
        <LanguageSelect
          value={locale}
          onChange={(next) => void changeLanguage(next)}
          label={messages.common.language}
          disabled={updatingLanguage}
          labelStyle={{ ...fieldLabel, fontWeight: 800 }}
          selectStyle={{ ...fieldInput, padding: '0 14px' }}
        />
      </section>
    </div>
  );
}
