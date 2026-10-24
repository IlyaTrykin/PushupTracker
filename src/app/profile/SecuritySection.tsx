'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { profileSectionsMessages } from '@/i18n/messages/features/profile-sections';
import { PASSWORD_MIN_LENGTH } from '@/lib/account-validation';
import BlockedUsers from './BlockedUsers';
import { buttonSecondary, errorBox, fieldInput, okText, panelCard, sectionTitle } from './profile-styles';

/** «Безопасность»: смена пароля и заблокированные пользователи. */
export default function SecuritySection() {
  const { locale, messages } = useI18n();
  const text = profileSectionsMessages[locale].security;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState('');

  async function changePassword() {
    setError('');
    setChanged(false);
    if (!currentPassword) {
      setError(messages.profile.password.missingCurrent);
      return;
    }
    if (Array.from(newPassword).length < PASSWORD_MIN_LENGTH) {
      setError(messages.profile.password.minLength);
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError(messages.profile.password.mismatch);
      return;
    }

    setChanging(true);
    try {
      const res = await fetch('/api/profile/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || messages.profile.errors.changePassword);
      } else {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
        setChanged(true);
      }
    } catch {
      setError(messages.profile.errors.network);
    } finally {
      setChanging(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={panelCard}>
        <div style={sectionTitle}>{messages.profile.sections.password}</div>
        <div style={{ display: 'grid', gap: 10 }}>
          <input
            type="password"
            autoComplete="current-password"
            placeholder={messages.profile.password.current}
            aria-label={messages.profile.password.current}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            style={fieldInput}
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder={messages.profile.password.next}
            aria-label={messages.profile.password.next}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={fieldInput}
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder={messages.profile.password.confirm}
            aria-label={messages.profile.password.confirm}
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            style={fieldInput}
          />
          {error ? (
            <div style={errorBox} role="alert">
              {error}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => void changePassword()}
              disabled={changing}
              style={{ ...buttonSecondary, cursor: changing ? 'not-allowed' : 'pointer', opacity: changing ? 0.6 : 1 }}
            >
              {changing ? messages.profile.password.submitting : messages.profile.password.submit}
            </button>
            {changed ? (
              <span style={okText} role="status">
                {text.passwordChanged}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <BlockedUsers />
    </div>
  );
}
