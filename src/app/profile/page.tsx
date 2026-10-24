'use client';

import { Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/auth/provider';
import TelegramConnect from '@/components/TelegramConnect';
import { useLogout } from '@/components/AppNavClient';
import { InfoButton, MenuList, MenuRow, SubpageStack, useSubpage, type SubpageDef } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { privacyMessages } from '@/i18n/messages/features/privacy';
import { legalMessages } from '@/i18n/messages/features/legal';
import { fillProfileText, profileSectionsMessages } from '@/i18n/messages/features/profile-sections';
import { getUserScopedCacheKey, readCachedValue, writeCachedValue } from '@/lib/client-cache';
import { healthPlatform, isHealthWriteEnabled } from '@/lib/health/health';
import { forgetAccountOnDevice } from '@/lib/offline/forget-account';
import { hardNavigate, isNativeApp, mediaUrl, openExternal, publicLink } from '@/lib/platform';
import HealthSettings from './HealthSettings';
import NotificationSettings from './NotificationSettings';
import PersonalSection from './PersonalSection';
import SecuritySection from './SecuritySection';
import TrainingSection from './TrainingSection';
import { LEGACY_HASH_SECTIONS, PROFILE_SECTIONS, type Profile, type ProfileSection } from './sections';
import {
  avatarCircle,
  buttonDanger,
  buttonSecondary,
  dangerCard,
  errorBox,
  eyebrow,
  fieldHint,
  heroCard,
  heroMeta,
  heroTitle,
  panelCard,
  profilePage,
  sectionTitle,
  titleRow,
} from './profile-styles';

const noSubscribe = () => () => undefined;

/** Профиль (R12/R14): шапка и список разделов; каждый раздел — уровень `?section=<id>`. */
export default function ProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfileScreen />
    </Suspense>
  );
}

function ProfileScreen() {
  const { user, setUser } = useAuth();
  const router = useRouter();
  const logout = useLogout();
  const { locale, messages } = useI18n();
  const text = profileSectionsMessages[locale];
  const legalText = legalMessages[locale];
  const healthOn = useSyncExternalStore(noSubscribe, isHealthWriteEnabled, () => false);
  // «Здоровье» есть только в приложении (Apple Health / Health Connect); на сайте раздела нет.
  const platform = useSyncExternalStore(noSubscribe, healthPlatform, () => null);
  const cacheKey = useMemo(() => getUserScopedCacheKey('profile', user?.id, user?.username), [user?.id, user?.username]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState('');
  const [accountError, setAccountError] = useState('');

  const avatarUrl = useMemo(() => mediaUrl(profile?.avatarPath) ?? '', [profile?.avatarPath]);

  const applyProfile = useCallback(
    (next: Profile) => {
      setProfile(next);
      setUser((prev) => ({
        ...prev,
        id: next.id,
        email: next.email,
        username: next.username,
        isAdmin: next.isAdmin,
        avatarPath: next.avatarPath,
        language: next.language,
        weightKg: next.weightKg ?? null,
        ...(next.heightCm !== undefined ? { heightCm: next.heightCm } : {}),
        birthDate: next.birthDate ?? null,
        gender: next.gender === 'male' || next.gender === 'female' || next.gender === 'other' ? next.gender : null,
        ...(next.timeZone !== undefined
          ? {
              timeZone: next.timeZone,
              dailyGoalPoints: next.dailyGoalPoints ?? null,
              dailyReminderTime: next.dailyReminderTime ?? null,
            }
          : {}),
      }));
    },
    [setUser],
  );

  const load = useCallback(
    async ({ preferCache = false }: { preferCache?: boolean } = {}) => {
      const cached = preferCache ? readCachedValue<Profile>(cacheKey) : null;
      // Перечитывание после сохранения не прячет открытый раздел за «Загрузка…» (иначе пропадут «Сохранено» и ошибки).
      if (preferCache) setLoading(!cached);
      setLoadError('');
      if (cached) applyProfile(cached);
      try {
        const res = await fetch('/api/profile', { cache: 'no-store', credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (preferCache && !cached) {
            setProfile(null);
            setUser(null);
            setLoadError(data.error || messages.profile.errors.load);
          }
        } else {
          applyProfile(data as Profile);
          writeCachedValue(cacheKey, data);
        }
      } catch {
        if (preferCache && !cached) setLoadError(messages.profile.errors.network);
      } finally {
        setLoading(false);
      }
    },
    [applyProfile, cacheKey, messages.profile.errors.load, messages.profile.errors.network, setUser],
  );

  const reload = useCallback(() => load(), [load]);

  useEffect(() => {
    void load({ preferCache: true });
  }, [load]);

  // Старые ссылки с якорем (R14.1): `/profile#daily-goal` с дашборда → раздел «Тренировки».
  useEffect(() => {
    const section = LEGACY_HASH_SECTIONS[window.location.hash];
    if (!section) return;
    const params = new URLSearchParams(window.location.search);
    params.set('section', section);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, []);

  async function deleteProfile() {
    if (!confirm(messages.profile.delete.confirm)) return;
    setAccountError('');
    try {
      const res = await fetch('/api/profile', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAccountError(data.error || messages.profile.errors.delete);
      } else {
        // The account is gone: its token, caches, queue and background copies go from the device too.
        await forgetAccountOnDevice(user?.id);
        setUser(null);
        window.dispatchEvent(new CustomEvent('authChanged', { detail: null }));
        hardNavigate('/login', router);
      }
    } catch {
      setAccountError(messages.profile.errors.network);
    }
  }

  if (loading) return <div style={{ padding: 16, color: '#475569' }}>{messages.common.loading}</div>;
  if (!profile) {
    return (
      <div className="app-page" style={profilePage}>
        <div style={errorBox} role="alert">
          {loadError || messages.profile.errors.load}
        </div>
      </div>
    );
  }

  const legalLinks = [
    { path: '/privacy', label: privacyMessages[locale].profileLink },
    { path: '/terms', label: legalText.navTerms },
    { path: '/support', label: legalText.navSupport },
    { path: '/account-deletion', label: legalText.navDeletion },
  ];
  const openLegal = (path: string) => {
    if (isNativeApp()) openExternal(publicLink(path));
    else window.open(path, '_blank', 'noopener,noreferrer');
  };

  const visibleSections = PROFILE_SECTIONS.filter((id) => id !== 'health' || platform !== null);
  const sectionValue: Partial<Record<ProfileSection, string>> = {
    training:
      profile.dailyGoalPoints != null ? fillProfileText(text.values.goal, { goal: profile.dailyGoalPoints }) : text.values.noGoal,
    health: healthOn ? text.values.healthOn : text.values.healthOff,
  };

  const pages: Partial<Record<ProfileSection, SubpageDef>> = {
    personal: {
      title: text.sections.personal.title,
      content: () => <PersonalSection profile={profile} avatarUrl={avatarUrl} reload={reload} />,
    },
    training: {
      title: text.sections.training.title,
      content: () => <TrainingSection profile={profile} reload={reload} />,
    },
    // На сайте раздела нет: `?section=health` там показывает корень профиля.
    ...(platform
      ? {
          health: {
            title: text.sections.health.title,
            content: () => <HealthSettings showTitle={false} />,
          },
        }
      : {}),
    notifications: {
      title: text.sections.notifications.title,
      content: () => (
        <div style={{ display: 'grid', gap: 18 }}>
          <section style={panelCard}>
            <div style={{ ...sectionTitle, ...titleRow }}>
              {messages.profile.sections.notifications}
              <InfoButton title={messages.profile.sections.notifications}>
                <p>{messages.profile.notifications.summary}</p>
                {profile.isAdmin ? <p>{messages.profile.notifications.adminSummary}</p> : null}
              </InfoButton>
            </div>
            <NotificationSettings />
          </section>
          <TelegramConnect />
        </div>
      ),
    },
    security: {
      title: text.sections.security.title,
      content: () => <SecuritySection />,
    },
    docs: {
      title: legalText.navTitle,
      content: () => (
        <MenuList label={legalText.navTitle}>
          {legalLinks.map((link) => (
            <MenuRow key={link.path} label={link.label} value="↗" chevron={false} onClick={() => openLegal(link.path)} />
          ))}
        </MenuList>
      ),
    },
    account: {
      title: text.sections.account.title,
      content: () => (
        <div style={{ display: 'grid', gap: 18 }}>
          <section style={panelCard}>
            <div style={fieldHint}>{text.account.logoutHint}</div>
            <div>
              <button type="button" onClick={() => void logout()} style={{ ...buttonSecondary, cursor: 'pointer' }} data-testid="profile-logout">
                {text.account.logout}
              </button>
            </div>
          </section>
          <section style={dangerCard}>
            <div style={sectionTitle}>{text.account.deleteTitle}</div>
            {/* Необратимое — на виду, не под «i». */}
            <div style={fieldHint}>{messages.profile.delete.confirm}</div>
            {accountError ? (
              <div style={errorBox} role="alert">
                {accountError}
              </div>
            ) : null}
            <div>
              <button type="button" onClick={() => void deleteProfile()} style={buttonDanger}>
                {messages.profile.delete.button}
              </button>
            </div>
          </section>
        </div>
      ),
    },
  };

  const root = (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={heroCard}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ ...avatarCircle, width: 84, height: 84, fontSize: 28 }}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span>{(profile.username || 'U').slice(0, 1).toUpperCase()}</span>
            )}
          </div>
          <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
            <div style={eyebrow}>{messages.nav.pageTitles.profile}</div>
            <h1 style={heroTitle}>{profile.username || messages.profile.fields.username}</h1>
            <div style={heroMeta}>{profile.email}</div>
          </div>
        </div>
      </section>

      <SectionList sections={visibleSections} values={sectionValue} />
    </div>
  );

  return (
    <div className="app-page" style={profilePage}>
      <SubpageStack root={root} pages={pages as Record<string, SubpageDef>} />
    </div>
  );
}

function SectionList({ sections, values }: { sections: ProfileSection[]; values: Partial<Record<ProfileSection, string>> }) {
  const { locale } = useI18n();
  const text = profileSectionsMessages[locale];
  const { open } = useSubpage();
  return (
    <MenuList label={text.listLabel}>
      {sections.map((id) => (
        <MenuRow
          key={id}
          label={id === 'docs' ? legalMessages[locale].navTitle : text.sections[id].title}
          hint={text.sections[id].hint}
          value={values[id]}
          onClick={() => open(id)}
          testId={`profile-section-${id}`}
        />
      ))}
    </MenuList>
  );
}
