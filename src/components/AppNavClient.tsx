'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

type Me = { username: string; isAdmin?: boolean; avatarPath?: string | null };
type ExerciseType = 'pushups' | 'pullups' | 'crunches' | 'squats';
type AuthChangedDetail = Me | null;

function resolvePageTitle(pathname: string | null) {
  if (!pathname || pathname === '/') return 'Главная';
  if (pathname.startsWith('/dashboard')) return 'Тренировка';
  if (pathname.startsWith('/program/session/')) return 'Тренировка по программе';
  if (pathname.startsWith('/program')) return 'Программа';
  if (pathname.startsWith('/friends')) return 'Друзья';
  if (pathname.startsWith('/challenges/')) return 'Соревнование';
  if (pathname.startsWith('/challenges')) return 'Соревнования';
  if (pathname.startsWith('/progress')) return 'Сводка';
  if (pathname.startsWith('/notifications')) return 'Уведомления';
  if (pathname.startsWith('/profile')) return 'Профиль';
  if (pathname.startsWith('/admin/users')) return 'Админка';
  if (pathname.startsWith('/login')) return 'Вход';
  if (pathname.startsWith('/register')) return 'Регистрация';
  if (pathname.startsWith('/forgot-password')) return 'Восстановление пароля';
  if (pathname.startsWith('/reset-password')) return 'Новый пароль';
  return 'Tracker';
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </span>
  );
}

export default function AppNavClient() {
  const pathname = usePathname();
  const pageTitle = useMemo(() => resolvePageTitle(pathname), [pathname]);
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [exerciseType, setExerciseType] = useState<ExerciseType>('pushups');
  const navIconVersion = '20260225';

  const navActive = (href: string) => pathname === href || (href !== '/' && pathname?.startsWith(href));
  const bottomItemClass = (active: boolean) => `bottom-nav__item ${active ? 'bottom-nav__item--active' : ''}`;

  const exerciseLabel = useMemo(() => {
    if (exerciseType === 'pushups') return 'Отжимания';
    if (exerciseType === 'pullups') return 'Подтягивания';
    if (exerciseType === 'crunches') return 'Скручивания';
    return 'Приседания';
  }, [exerciseType]);

  const loadMe = async () => {
    try {
      const res = await fetch('/api/me', { cache: 'no-store', credentials: 'include' });
      if (!res.ok) {
        setMe(null);
        return;
      }
      const data = (await res.json()) as Me;
      setMe(data);
    } catch {
      setMe(null);
    }
  };

  useEffect(() => {
    loadMe();
  }, [pathname]);

  useEffect(() => {
    const onAuthChanged = (event: Event) => {
      const detail = (event as CustomEvent<AuthChangedDetail>).detail;
      if (detail && detail.username) {
        setMe(detail);
        return;
      }
      loadMe();
    };

    window.addEventListener('authChanged', onAuthChanged as EventListener);
    return () => window.removeEventListener('authChanged', onAuthChanged as EventListener);
  }, [pathname]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('exerciseType');
      if (saved === 'pushups' || saved === 'pullups' || saved === 'crunches' || saved === 'squats') {
        setExerciseType(saved);
      }
    } catch {}

    const onChanged = (e: any) => {
      const t = e?.detail?.exerciseType ?? e?.detail;
      if (t === 'pushups' || t === 'pullups' || t === 'crunches' || t === 'squats') {
        setExerciseType(t);
      }
    };
    window.addEventListener('exerciseTypeChanged', onChanged as any);
    return () => window.removeEventListener('exerciseTypeChanged', onChanged as any);
  }, []);

  const logout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    setMe(null);
    window.dispatchEvent(new CustomEvent<AuthChangedDetail>('authChanged', { detail: null }));
    window.location.href = '/login';
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
                <span>{me?.username || 'Гость'}</span>
              </span>
            </div>
            <button
              type="button"
              className="app-menu-btn"
              onClick={() => setOpen(true)}
              aria-label="Меню"
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
              <img src="/icons/bottom-nav/menu.svg" className="bottom-nav__icon" alt="" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <nav className="bottom-nav" role="navigation" aria-label="Нижнее меню">
        <Link className={bottomItemClass(navActive('/dashboard'))} href="/dashboard" aria-label="Тренировка">
          <img src={`/icons/bottom-nav/training.svg?v=${navIconVersion}`} className="bottom-nav__icon" alt="" aria-hidden="true" />
          <span className="bottom-nav__label">Тренировка</span>
        </Link>

        <Link className={bottomItemClass(navActive('/program'))} href="/program" aria-label="Программа">
          <img src="/icons/bottom-nav/program.svg" className="bottom-nav__icon" alt="" aria-hidden="true" />
          <span className="bottom-nav__label">Программа</span>
        </Link>

        <Link className={bottomItemClass(navActive('/friends'))} href="/friends" aria-label="Друзья">
          <img src="/icons/bottom-nav/friends.svg" className="bottom-nav__icon" alt="" aria-hidden="true" />
          <span className="bottom-nav__label">Друзья</span>
        </Link>

        <Link className={bottomItemClass(navActive('/challenges'))} href="/challenges" aria-label="Соревнования">
          <img src={`/icons/bottom-nav/challenges.svg?v=${navIconVersion}`} className="bottom-nav__icon" alt="" aria-hidden="true" />
          <span className="bottom-nav__label">Соревнования</span>
        </Link>

        <Link className={bottomItemClass(navActive('/progress'))} href="/progress" aria-label="Сводка">
          <img src="/icons/bottom-nav/summary.svg" className="bottom-nav__icon" alt="" aria-hidden="true" />
          <span className="bottom-nav__label">Сводка</span>
        </Link>
      </nav>

      {open ? (
        <div className="app-drawer-overlay" onClick={() => setOpen(false)}>
          <div className="app-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="app-drawer__top">
              <div className="app-drawer__user">
                <div style={{ fontWeight: 900, color: '#000' }}>
                  {me?.username || 'Пользователь не авторизован'}
                </div>
                <div style={{ fontSize: 12, color: '#000', opacity: 0.75 }}>{exerciseLabel}</div>
              </div>

              <button type="button" className="app-drawer__close" onClick={() => setOpen(false)} aria-label="Закрыть">
                ✕
              </button>
            </div>

            <div className="app-drawer__links">
              {me?.username ? (
                <Link className={linkClass('/profile')} href="/profile" onClick={() => setOpen(false)}>
                  Профиль
                </Link>
              ) : null}

              {me?.isAdmin ? (
                <Link className={linkClass('/admin/users')} href="/admin/users" onClick={() => setOpen(false)}>
                  Админка
                </Link>
              ) : null}

              <a
                className="app-drawer__btn"
                href="mailto:PushupTrackerApp@gmail.com"
                onClick={() => setOpen(false)}
              >
                Обратная связь: PushupTrackerApp@gmail.com
              </a>

              <div style={{ height: 8 }} />

              {me?.username ? (
                <button type="button" className="app-drawer__btn app-drawer__btn--danger" onClick={logout}>
                  Выйти
                </button>
              ) : (
                <Link className={linkClass('/login')} href="/login" onClick={() => setOpen(false)}>
                  Вход
                </Link>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
