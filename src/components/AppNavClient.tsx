'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/auth/provider';
import { clearClientDataCaches } from '@/lib/client-cache';
import { clearToken } from '@/lib/native-auth';
import { currentPushToken } from '@/lib/native-push-client';
import { cancelAllBackground } from '@/lib/offline/background-upload';
import { useOutboxLogoutGuard } from '@/lib/offline/logout-guard';
import { useOutboxSync } from '@/lib/offline/use-outbox';
import { hardNavigate, isNativeApp, mediaUrl, openExternal, publicLink } from '@/lib/platform';
import { SUPPORT_URL } from '@/lib/support';
import FeedbackSheet from '@/components/FeedbackSheet';
import LanguageSelect from '@/components/LanguageSelect';
import { pushLayer } from '@/components/ui/layers';
import { type Locale, normalizeLocale } from '@/i18n/locale';
import { useI18n } from '@/i18n/provider';
import { nativeHealthMessages } from '@/i18n/messages/features/native-health';
import { profileSectionsMessages } from '@/i18n/messages/features/profile-sections';
import { uiKitMessages } from '@/i18n/messages/features/ui-kit';
import styles from './AppNavClient.module.css';

type PageTitleOverrideDetail = string | { title?: string | null } | null;
type PageHeaderActionDetail = string | { label?: string | null } | null;
const APP_SHELL_PREWARM_VERSION = '20260327-1';
// Приложение рисуется под строкой состояния и вырезом (viewport-fit=cover): шапка отступает на safe-area.
const NATIVE_HEADER_STYLE: React.CSSProperties = { paddingTop: 'calc(10px + var(--safe-top, 0px))' };
const NATIVE_DRAWER_STYLE: React.CSSProperties = {
  top: 'calc(12px + var(--safe-top, 0px))',
  maxHeight: 'calc(100vh - 24px - var(--safe-top, 0px) - var(--safe-bottom, 0px))',
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
}

async function unsubscribeThisDeviceFromPush(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const registration = await withTimeout(navigator.serviceWorker.getRegistration(), 1500);
    const subscription = registration ? await withTimeout(registration.pushManager.getSubscription(), 1500) : null;
    if (!subscription) return;
    await withTimeout(
      fetch('/api/push/subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }),
      3000,
    );
    await withTimeout(subscription.unsubscribe(), 1500);
  } catch {}
}

function resolvePageTitle(pathname: string | null, titles: ReturnType<typeof useI18n>['messages']['nav']['pageTitles'], locale: Locale) {
  if (!pathname || pathname === '/') return titles.home;
  if (pathname.startsWith('/health-import')) return nativeHealthMessages[locale === 'en' ? 'en' : 'ru'].importTitle;
  if (pathname.startsWith('/dashboard')) return titles.dashboard;
  if (pathname.startsWith('/program/session')) return titles.programSession;
  if (pathname.startsWith('/program')) return titles.program;
  if (pathname.startsWith('/friends')) return titles.friends;
  if (pathname.startsWith('/groups')) return titles.groups;
  if (pathname.startsWith('/challenges/')) return titles.challenge;
  if (pathname.startsWith('/challenges')) return titles.challenges;
  if (pathname.startsWith('/progress')) return titles.progress;
  if (pathname.startsWith('/notifications')) return titles.notifications;
  if (pathname.startsWith('/profile')) return titles.profile;
  if (pathname.startsWith('/admin/users')) return titles.adminUsers;
  if (pathname.startsWith('/admin/growth')) return titles.adminUsers;
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
      <Image src={mediaUrl(src) ?? src} alt="" width={size} height={size} unoptimized style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </span>
  );
}

function LeaveGroupIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 4.75H6.75A1.75 1.75 0 0 0 5 6.5v11A1.75 1.75 0 0 0 6.75 19.25H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 8.5 18.5 12 14 15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 4.75h5.25A1.75 1.75 0 0 1 17 6.5v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
      <path d="M17 15.5v2A1.75 1.75 0 0 1 15.25 19.25H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
    </svg>
  );
}

/**
 * Выход из аккаунта — общий для бокового меню и «Профиль → Аккаунт»: неотправленные тренировки
 * (спросить), фоновые копии, push этого устройства, сессия, токен, кэши, затем /login.
 */
export function useLogout(): () => Promise<void> {
  const { setUser } = useAuth();
  const router = useRouter();
  const { checkBeforeLogout } = useOutboxLogoutGuard();
  return useCallback(async () => {
    // Unsent workouts on this device: try to send, then «sign out and delete» / «stay».
    if ((await checkBeforeLogout()) === 'stay') return;
    // Their native background copies must not go out after the user chose to delete them.
    await cancelAllBackground();
    // Отписать это устройство от push до выхода (B19): иначе на общем устройстве
    // продолжат приходить уведомления вышедшего пользователя.
    if (!isNativeApp()) await unsubscribeThisDeviceFromPush();
    try {
      // В приложении запрос идёт с Bearer и закрывает только эту сессию; без связи не ждём.
      // Токен пушей этого телефона: сервер снимает устройство, чтобы уведомления вышедшего не приходили.
      const pushToken = isNativeApp() ? currentPushToken() : null;
      const request = fetch('/api/logout', {
        method: 'POST',
        credentials: 'include',
        ...(pushToken ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pushToken }) } : {}),
      });
      await (isNativeApp() ? withTimeout(request, 5000) : request);
    } catch {}
    // Приложение: токен стирается с устройства даже без связи.
    await clearToken();
    try {
      navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_RUNTIME_CACHES' });
    } catch {}
    clearClientDataCaches();
    setUser(null);
    window.dispatchEvent(new CustomEvent('authChanged', { detail: null }));
    hardNavigate('/login', router);
  }, [checkBeforeLogout, router, setUser]);
}

/** Смена языка интерфейса с сохранением в профиль — общая для меню и «Персональной информации». */
export function useLanguageSwitch(): { change: (next: Locale) => Promise<void>; updating: boolean } {
  const { locale, setLocale } = useI18n();
  const { user: me, setUser, refreshUser } = useAuth();
  const [updating, setUpdating] = useState(false);
  const change = useCallback(
    async (nextLocale: Locale) => {
      if (!me?.username || updating || nextLocale === locale) return;
      const previousLocale = locale;
      setUpdating(true);
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
          setUser((prev) => ({
            ...prev,
            id: data.user.id,
            email: data.user.email,
            username: data.user.username,
            isAdmin: data.user.isAdmin,
            avatarPath: data.user.avatarPath,
            language: data.user.language,
          }));
        } else {
          await refreshUser();
        }
      } catch {
        setLocale(previousLocale);
        await refreshUser();
      } finally {
        setUpdating(false);
      }
    },
    [locale, me?.username, refreshUser, setLocale, setUser, updating],
  );
  return { change, updating };
}

type MenuView = 'root' | 'admin';

export default function AppNavClient() {
  const { locale, messages, setLocale } = useI18n();
  const { user: me } = useAuth();
  const pathname = usePathname();
  // '/' is the public landing — signed-in users are redirected to /dashboard on the server.
  const isAuthRoute = pathname === '/' || Boolean(pathname?.startsWith('/invite/')) || pathname === '/login' || pathname === '/register' || pathname === '/forgot-password' || pathname === '/reset-password';
  const [open, setOpen] = useState(false);
  // Уровень бокового меню: корень или «Админка» (R12.1); направление — для анимации въезда.
  const [menuView, setMenuView] = useState<MenuView>('root');
  const [menuDirection, setMenuDirection] = useState<'forward' | 'back' | 'none'>('none');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [pageTitleOverride, setPageTitleOverride] = useState<string | null>(null);
  const [pageHeaderActionLabel, setPageHeaderActionLabel] = useState<string | null>(null);
  const navIconVersion = '20260225';
  const menuText = profileSectionsMessages[locale].menu;
  const kitText = uiKitMessages[locale];
  // The workout queue goes out from any screen (the navigation is on all of them).
  useOutboxSync();
  const logout = useLogout();
  const { change: handleLanguageChange, updating: updatingLanguage } = useLanguageSwitch();
  const pageTitle = useMemo(
    () => pageTitleOverride || resolvePageTitle(pathname, messages.nav.pageTitles, locale),
    [locale, messages.nav.pageTitles, pageTitleOverride, pathname],
  );

  const navActive = (href: string) => pathname === href || (href !== '/' && pathname?.startsWith(href));
  const bottomItemClass = (active: boolean) => `bottom-nav__item ${active ? 'bottom-nav__item--active' : ''}`;

  useEffect(() => {
    if (me?.language) setLocale(normalizeLocale(me.language));
  }, [me?.language, setLocale]);

  useEffect(() => {
    setPageTitleOverride(null);
    setPageHeaderActionLabel(null);
  }, [pathname]);

  useEffect(() => {
    const onPageTitleChanged = (event: Event) => {
      const detail = (event as CustomEvent<PageTitleOverrideDetail>).detail;
      const nextTitle = typeof detail === 'string' ? detail : detail?.title;
      setPageTitleOverride(nextTitle?.trim() || null);
    };

    window.addEventListener('appPageTitleOverride', onPageTitleChanged);
    return () => window.removeEventListener('appPageTitleOverride', onPageTitleChanged);
  }, []);

  useEffect(() => {
    const onPageHeaderActionChanged = (event: Event) => {
      const detail = (event as CustomEvent<PageHeaderActionDetail>).detail;
      const nextLabel = typeof detail === 'string' ? detail : detail?.label;
      setPageHeaderActionLabel(nextLabel?.trim() || null);
    };

    window.addEventListener('appPageHeaderAction', onPageHeaderActionChanged);
    return () => window.removeEventListener('appPageHeaderAction', onPageHeaderActionChanged);
  }, []);

  useEffect(() => {
    if (isNativeApp() || !me?.username || !('serviceWorker' in navigator)) return;

    const identity = me.id || me.username;
    const prewarmKey = `app-shell-prewarmed:${APP_SHELL_PREWARM_VERSION}:${identity}`;
    const routes = ['/dashboard', '/program', '/friends', '/groups', '/challenges', '/progress', '/notifications', '/profile'];
    if (me.isAdmin) routes.push('/admin/users');

    const prewarm = async () => {
      try {
        if (window.localStorage.getItem(prewarmKey) === '1') return;
        const registration = await navigator.serviceWorker.ready;
        registration.active?.postMessage({ type: 'PREWARM_ROUTES', routes });
        window.localStorage.setItem(prewarmKey, '1');
      } catch {}
    };

    void prewarm();
  }, [me?.id, me?.isAdmin, me?.username]);

  const openMenu = () => {
    setMenuView('root');
    setMenuDirection('none');
    setOpen(true);
  };
  const closeMenu = useCallback(() => setOpen(false), []);
  const showMenuLevel = (view: MenuView) => {
    setMenuDirection(view === 'root' ? 'back' : 'forward');
    setMenuView(view);
  };

  // Открытое меню — слой UI-кита: Escape и аппаратная «назад» Android сначала возвращают из
  // «Админки» на корень меню, потом закрывают меню (а не уводят со страницы).
  const menuViewRef = useRef<MenuView>('root');
  useEffect(() => {
    menuViewRef.current = menuView;
  }, [menuView]);
  useEffect(() => {
    if (!open) return;
    const layer = pushLayer(() => {
      if (menuViewRef.current !== 'root') {
        setMenuDirection('back');
        setMenuView('root');
      } else {
        setOpen(false);
      }
    });
    return () => layer.remove();
  }, [open]);

  // Админка и внешние сайты в приложении открываются в системном браузере.
  const openOutside = (url: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    setOpen(false);
    if (!isNativeApp()) return;
    event.preventDefault();
    openExternal(url);
  };

  const linkClass = (href: string) => {
    const active = pathname === href || (href !== '/' && pathname?.startsWith(href));
    return `app-drawer__btn${active ? ' app-drawer__btn--active' : ''}`;
  };

  if (isAuthRoute) return null;

  return (
    <>
      <header className="app-header" style={isNativeApp() ? NATIVE_HEADER_STYLE : undefined}>
        <div className={`app-header-row ${styles.headerRow}`}>
          <div className={styles.titleBlock}>
            <div className={styles.eyebrow}>{messages.common.appName}</div>
            <div className={styles.pageTitle}>{pageTitle}</div>
          </div>

          <div className={styles.headerActions}>
            {pageHeaderActionLabel ? (
              <button
                type="button"
                className={styles.pageActionButton}
                title={pageHeaderActionLabel}
                aria-label={pageHeaderActionLabel}
                onClick={() => window.dispatchEvent(new CustomEvent('appPageHeaderActionClick'))}
              >
                <LeaveGroupIcon />
              </button>
            ) : null}
            <div className={styles.userPill}>
              <AvatarCircle src={me?.avatarPath ?? null} size={22} />
              <span className={styles.userName}>{me?.username || messages.common.guest}</span>
            </div>
            <button
              type="button"
              className={`${styles.menuButton} app-menu-btn`}
              onClick={openMenu}
              aria-label={messages.nav.menuAria}
              aria-expanded={open}
            >
              <Image src="/icons/bottom-nav/menu.svg" className="bottom-nav__icon" alt="" aria-hidden="true" width={22} height={22} />
            </button>
          </div>
        </div>
      </header>

      <nav className="bottom-nav" role="navigation" aria-label={messages.nav.menuAria}>
        <Link className={`${bottomItemClass(navActive('/dashboard'))} ${styles.bottomItem}`} href="/dashboard" aria-label={messages.nav.bottom.dashboard}>
          <span className={`${styles.bottomIconWrap} ${navActive('/dashboard') ? styles.bottomIconWrapActive : ''}`}>
            <Image src={`/icons/bottom-nav/training.svg?v=${navIconVersion}`} className="bottom-nav__icon" alt="" aria-hidden="true" width={22} height={22} unoptimized />
          </span>
          <span className={`${styles.bottomLabel} bottom-nav__label`}>{messages.nav.bottom.dashboard}</span>
        </Link>

        <Link className={`${bottomItemClass(navActive('/program'))} ${styles.bottomItem}`} href="/program" aria-label={messages.nav.bottom.program}>
          <span className={`${styles.bottomIconWrap} ${navActive('/program') ? styles.bottomIconWrapActive : ''}`}>
            <Image src="/icons/bottom-nav/program.svg" className="bottom-nav__icon" alt="" aria-hidden="true" width={22} height={22} />
          </span>
          <span className={`${styles.bottomLabel} bottom-nav__label`}>{messages.nav.bottom.program}</span>
        </Link>

        <Link className={`${bottomItemClass(navActive('/friends'))} ${styles.bottomItem}`} href="/friends" aria-label={messages.nav.bottom.friends}>
          <span className={`${styles.bottomIconWrap} ${navActive('/friends') ? styles.bottomIconWrapActive : ''}`}>
            <Image src="/icons/bottom-nav/friends.svg" className="bottom-nav__icon" alt="" aria-hidden="true" width={22} height={22} />
          </span>
          <span className={`${styles.bottomLabel} bottom-nav__label`}>{messages.nav.bottom.friends}</span>
        </Link>

        <Link className={`${bottomItemClass(navActive('/challenges'))} ${styles.bottomItem}`} href="/challenges" aria-label={messages.nav.bottom.challenges}>
          <span className={`${styles.bottomIconWrap} ${navActive('/challenges') ? styles.bottomIconWrapActive : ''}`}>
            <Image src={`/icons/bottom-nav/challenges.svg?v=${navIconVersion}`} className="bottom-nav__icon" alt="" aria-hidden="true" width={22} height={22} unoptimized />
          </span>
          <span className={`${styles.bottomLabel} bottom-nav__label`}>{messages.nav.bottom.challenges}</span>
        </Link>

        <Link className={`${bottomItemClass(navActive('/progress'))} ${styles.bottomItem}`} href="/progress" aria-label={messages.nav.bottom.progress}>
          <span className={`${styles.bottomIconWrap} ${navActive('/progress') ? styles.bottomIconWrapActive : ''}`}>
            <Image src="/icons/bottom-nav/summary.svg" className="bottom-nav__icon" alt="" aria-hidden="true" width={22} height={22} />
          </span>
          <span className={`${styles.bottomLabel} bottom-nav__label`}>{messages.nav.bottom.progress}</span>
        </Link>
      </nav>

      {open ? (
        <div className={`app-drawer-overlay ${styles.drawerOverlay}`} onClick={closeMenu}>
          <div
            className={`app-drawer ${styles.drawer}`}
            style={isNativeApp() ? NATIVE_DRAWER_STYLE : undefined}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={messages.nav.menuAria}
            data-testid="app-drawer"
          >
            <div className="app-drawer__top">
              {menuView === 'admin' ? (
                <div className={styles.drawerLevelHead}>
                  <button type="button" className={styles.drawerBack} onClick={() => showMenuLevel('root')} data-testid="drawer-back">
                    <span aria-hidden="true">‹</span> {kitText.back}
                  </button>
                  <div className={styles.drawerName}>{menuText.admin}</div>
                </div>
              ) : (
                <div className={styles.drawerIdentity}>
                  <div className={styles.drawerName}>{me?.username || messages.nav.unauthorized}</div>
                </div>
              )}

              <button type="button" className="app-drawer__close" onClick={closeMenu} aria-label={messages.nav.closeAria}>
                ✕
              </button>
            </div>

            {menuView === 'admin' && me?.isAdmin ? (
              <div key="admin" className={`app-drawer__links ${styles.drawerLinks} ui-slide-in`}>
                {[
                  { href: '/admin/users', label: menuText.adminUsers },
                  { href: '/admin/growth', label: menuText.adminGrowth },
                ].map((item) =>
                  isNativeApp() ? (
                    <a key={item.href} className="app-drawer__btn" href={publicLink(item.href)} onClick={openOutside(publicLink(item.href))}>
                      {item.label}
                    </a>
                  ) : (
                    <Link key={item.href} className={linkClass(item.href)} href={item.href} onClick={closeMenu}>
                      {item.label}
                    </Link>
                  ),
                )}
              </div>
            ) : (
              <div key="root" className={`app-drawer__links ${styles.drawerLinks} ${menuDirection === 'back' ? 'ui-slide-back' : ''}`}>
                {me?.username ? (
                  <Link className={linkClass('/profile')} href="/profile" onClick={closeMenu}>
                    {messages.nav.drawer.profile}
                  </Link>
                ) : null}

                {me?.isAdmin ? (
                  <button
                    type="button"
                    className={`app-drawer__btn ${styles.drawerNext} ${pathname?.startsWith('/admin') ? 'app-drawer__btn--active' : ''}`}
                    onClick={() => showMenuLevel('admin')}
                    data-testid="drawer-admin"
                  >
                    <span>{menuText.admin}</span>
                    <span className={styles.drawerChevron} aria-hidden="true">›</span>
                  </button>
                ) : null}

                {me?.username ? (
                  <button
                    type="button"
                    className="app-drawer__btn"
                    onClick={() => {
                      setFeedbackOpen(true);
                      setOpen(false);
                    }}
                  >
                    {messages.nav.drawer.feedback}
                  </button>
                ) : null}

                <a
                  className="app-drawer__btn"
                  href={SUPPORT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={openOutside(SUPPORT_URL)}
                >
                  {messages.nav.drawer.support}
                </a>

                {me?.username ? (
                  <div className={styles.languageWrap}>
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
                  <Link className={linkClass('/login')} href="/login" onClick={closeMenu}>
                    {messages.nav.drawer.login}
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <FeedbackSheet open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </>
  );
}
