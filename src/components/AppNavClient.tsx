'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/provider';
import LanguageSelect from '@/components/LanguageSelect';
import { type Locale, normalizeLocale } from '@/i18n/locale';
import { useI18n } from '@/i18n/provider';

type ExerciseType = 'pushups' | 'pullups' | 'crunches' | 'squats' | 'plank';
type ExerciseTypeChangedDetail = ExerciseType | { exerciseType?: ExerciseType };

function resolvePageTitle(pathname: string | null, titles: ReturnType<typeof useI18n>['messages']['nav']['pageTitles']) {
  if (!pathname || pathname === '/') return titles.home;
  if (pathname.startsWith('/dashboard')) return titles.dashboard;
  if (pathname.startsWith('/program/session/')) return titles.programSession;
  if (pathname.startsWith('/program')) return titles.program;
  if (pathname.startsWith('/friends')) return titles.friends;
  if (pathname.startsWith('/challenges/')) return titles.challenge;
  if (pathname.startsWith('/challenges')) return titles.challenges;
  if (pathname.startsWith('/progress')) return titles.progress;
  if (pathname.startsWith('/notifications')) return titles.notifications;
  if (pathname.startsWith('/profile')) return titles.profile;
  if (pathname.startsWith('/admin/users')) return titles.adminUsers;
  if (pathname.startsWith('/login')) return titles.login;
  if (pathname.startsWith('/register')) return titles.register;
  if (pathname.startsWith('/forgot-password')) return titles.forgotPassword;
  if (pathname.startsWith('/reset-password')) return titles.resetPassword;
  return titles.fallback;
}

function AvatarCircle({ src, size = 24 }: { src?: string | null; size?: number }) {
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    background: '#fff',
    border: '1px solid rgba(0,0,0,0.12)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flex: '0 0 auto',
  };

  if (!src) return <span style={base} aria-hidden="true" />;

  return (
    <span style={base}>
      <Image src={src} alt="" width={size} height={size} unoptimized style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </span>
  );
}

export default function AppNavClient() {
  const { locale, messages, setLocale } = useI18n();
  const { user: me, setUser, refreshUser } = useAuth();
  const pathname = usePathname();
  const pageTitle = useMemo(() => resolvePageTitle(pathname, messages.nav.pageTitles), [messages.nav.pageTitles, pathname]);
  const [open, setOpen] = useState(false);
  const [exerciseType, setExerciseType] = useState<ExerciseType>('pushups');
  const [updatingLanguage, setUpdatingLanguage] = useState(false);
  const navIconVersion = '20260225';

  const navActive = (href: string) => pathname === href || (href !== '/' && pathname?.startsWith(href));
  const bottomItemClass = (active: boolean) => `bottom-nav__item ${active ? 'bottom-nav__item--active' : ''}`;

  const exerciseLabel = useMemo(() => {
    if (exerciseType === 'pushups') return messages.nav.exercise.pushups;
    if (exerciseType === 'pullups') return messages.nav.exercise.pullups;
    if (exerciseType === 'crunches') return messages.nav.exercise.crunches;
    if (exerciseType === 'squats') return messages.nav.exercise.squats;
    return messages.nav.exercise.plank;
  }, [exerciseType, messages.nav.exercise]);

  useEffect(() => {
    if (me?.language) setLocale(normalizeLocale(me.language));
  }, [me?.language, setLocale]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('exerciseType');
      if (saved === 'pushups' || saved === 'pullups' || saved === 'crunches' || saved === 'squats' || saved === 'plank') {
        setExerciseType(saved);
      }
    } catch {}

    const onChanged = (event: Event) => {
      const e = event as CustomEvent<ExerciseTypeChangedDetail>;
      const detail = e.detail;
      const t = typeof detail === 'string' ? detail : detail?.exerciseType;
      if (t === 'pushups' || t === 'pullups' || t === 'crunches' || t === 'squats' || t === 'plank') {
        setExerciseType(t);
      }
    };
    window.addEventListener('exerciseTypeChanged', onChanged);
    return () => window.removeEventListener('exerciseTypeChanged', onChanged);
  }, []);

  const logout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    setUser(null);
    window.dispatchEvent(new CustomEvent('authChanged', { detail: null }));
    window.location.href = '/login';
  };

  const handleLanguageChange = async (nextLocale: Locale) => {
    if (!me?.username || updatingLanguage || nextLocale === locale) return;
    const previousLocale = locale;
    setUpdatingLanguage(true);
    setLocale(nextLocale);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ language: nextLocale }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to update language');
      if (data?.user) {
        setUser({
          id: data.user.id,
          email: data.user.email,
          username: data.user.username,
          isAdmin: data.user.isAdmin,
          avatarPath: data.user.avatarPath,
          language: data.user.language,
        });
      } else {
        await refreshUser();
      }
    } catch {
      setLocale(previousLocale);
      await refreshUser();
    } finally {
      setUpdatingLanguage(false);
    }
  };

  const linkClass = (href: string) => {
    const active = pathname === href || (href !== '/' && pathname?.startsWith(href));
    return `app-drawer__btn${active ? ' app-drawer__btn--active' : ''}`;
  };

  return (
    <>
      <header className="app-header">
        <div className="app-header-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{ fontWeight: 900, color: '#000', textDecoration: 'none', whiteSpace: 'nowrap' }}>
              {pageTitle}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
            <div
              style={{
                color: '#000',
                fontWeight: 800,
                maxWidth: 140,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <AvatarCircle src={me?.avatarPath ?? null} size={22} />
                <span>{me?.username || messages.common.guest}</span>
              </span>
            </div>
            <button
              type="button"
              className="app-menu-btn"
              onClick={() => setOpen(true)}
              aria-label={messages.nav.menuAria}
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                border: '1px solid #d1d5db',
                background: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flex: '0 0 auto',
              }}
            >
              <Image src="/icons/bottom-nav/menu.svg" className="bottom-nav__icon" alt="" aria-hidden="true" width={22} height={22} />
            </button>
          </div>
        </div>
      </header>

      <nav className="bottom-nav" role="navigation" aria-label={messages.nav.menuAria}>
        <Link className={bottomItemClass(navActive('/dashboard'))} href="/dashboard" aria-label={messages.nav.bottom.dashboard}>
          <Image src={`/icons/bottom-nav/training.svg?v=${navIconVersion}`} className="bottom-nav__icon" alt="" aria-hidden="true" width={22} height={22} unoptimized />
          <span className="bottom-nav__label">{messages.nav.bottom.dashboard}</span>
        </Link>

        <Link className={bottomItemClass(navActive('/program'))} href="/program" aria-label={messages.nav.bottom.program}>
          <Image src="/icons/bottom-nav/program.svg" className="bottom-nav__icon" alt="" aria-hidden="true" width={22} height={22} />
          <span className="bottom-nav__label">{messages.nav.bottom.program}</span>
        </Link>

        <Link className={bottomItemClass(navActive('/friends'))} href="/friends" aria-label={messages.nav.bottom.friends}>
          <Image src="/icons/bottom-nav/friends.svg" className="bottom-nav__icon" alt="" aria-hidden="true" width={22} height={22} />
          <span className="bottom-nav__label">{messages.nav.bottom.friends}</span>
        </Link>

        <Link className={bottomItemClass(navActive('/challenges'))} href="/challenges" aria-label={messages.nav.bottom.challenges}>
          <Image src={`/icons/bottom-nav/challenges.svg?v=${navIconVersion}`} className="bottom-nav__icon" alt="" aria-hidden="true" width={22} height={22} unoptimized />
          <span className="bottom-nav__label">{messages.nav.bottom.challenges}</span>
        </Link>

        <Link className={bottomItemClass(navActive('/progress'))} href="/progress" aria-label={messages.nav.bottom.progress}>
          <Image src="/icons/bottom-nav/summary.svg" className="bottom-nav__icon" alt="" aria-hidden="true" width={22} height={22} />
          <span className="bottom-nav__label">{messages.nav.bottom.progress}</span>
        </Link>
      </nav>

      {open ? (
        <div className="app-drawer-overlay" onClick={() => setOpen(false)}>
          <div className="app-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="app-drawer__top">
              <div className="app-drawer__user">
                <div style={{ fontWeight: 900, color: '#000' }}>
                  {me?.username || messages.nav.unauthorized}
                </div>
                <div style={{ fontSize: 12, color: '#000', opacity: 0.75 }}>{exerciseLabel}</div>
              </div>

              <button type="button" className="app-drawer__close" onClick={() => setOpen(false)} aria-label={messages.nav.closeAria}>
                ✕
              </button>
            </div>

            <div className="app-drawer__links">
              {me?.username ? (
                <Link className={linkClass('/profile')} href="/profile" onClick={() => setOpen(false)}>
                  {messages.nav.drawer.profile}
                </Link>
              ) : null}

              {me?.isAdmin ? (
                <Link className={linkClass('/admin/users')} href="/admin/users" onClick={() => setOpen(false)}>
                  {messages.nav.drawer.admin}
                </Link>
              ) : null}

              <a
                className="app-drawer__btn"
                href="mailto:PushupTrackerApp@gmail.com"
                onClick={() => setOpen(false)}
              >
                {messages.nav.drawer.feedbackEmail}
              </a>

              {me?.username ? (
                <div style={{ padding: '4px 2px' }}>
                  <LanguageSelect
                    value={locale}
                    onChange={handleLanguageChange}
                    label={messages.common.language}
                    disabled={updatingLanguage}
                  />
                </div>
              ) : null}

              <div style={{ height: 8 }} />

              {me?.username ? (
                <button type="button" className="app-drawer__btn app-drawer__btn--danger" onClick={logout}>
                  {messages.nav.drawer.logout}
                </button>
              ) : (
                <Link className={linkClass('/login')} href="/login" onClick={() => setOpen(false)}>
                  {messages.nav.drawer.login}
                </Link>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
