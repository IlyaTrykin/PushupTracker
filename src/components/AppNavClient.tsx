'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

type Me = { username: string; isAdmin?: boolean; avatarPath?: string | null };


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
  const handleExerciseTypeChange = (e: any) => {
    const next = String(e?.target?.value || 'pushups');
    setExerciseType(next as any);
    try { window.localStorage.setItem('exerciseType', next); } catch {}
    try { window.dispatchEvent(new CustomEvent('exerciseTypeChanged', { detail: { exerciseType: next } })); } catch {}
  };

  const pathname = usePathname();
  const navActive = (href: string) => pathname === href || (href !== "/" && pathname?.startsWith(href));
  const bottomItemClass = (active: boolean) => `bottom-nav__item ${active ? "bottom-nav__item--active" : ""}`;

  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [exerciseType, setExerciseType] = useState<'pushups' | 'pullups' | 'crunches' | 'squats'>('pushups');

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
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('exerciseType');
      if (saved === 'pushups' || saved === 'pullups' || saved === 'crunches' || saved === 'squats') setExerciseType(saved);
    } catch {}

    const onChanged = (e: any) => {
      const t = e?.detail?.exerciseType ?? e?.detail;
      if (t === 'pushups' || t === 'pullups' || t === 'crunches' || t === 'squats') setExerciseType(t);
    };

    window.addEventListener('exerciseTypeChanged', onChanged as any);
  const IconHome = ({ className }: { className?: string }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9.8V21h14V9.8" />
      <path d="M10 21v-7h4v7" />
    </svg>
  );

  const IconFriends = ({ className }: { className?: string }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 12.2c2 0 3.6-1.6 3.6-3.6S14 5 12 5 8.4 6.6 8.4 8.6 10 12.2 12 12.2z" />
      <path d="M6.5 21c.7-3.1 3-5.2 5.5-5.2s4.8 2.1 5.5 5.2" />
      <path d="M6.9 12c1.6 0 2.9-1.3 2.9-2.9S8.5 6.2 6.9 6.2 4 7.5 4 9.1 5.3 12 6.9 12z" />
      <path d="M2.6 20.6c.4-2.2 2-3.8 3.8-4.3" />
      <path d="M17.1 12c1.6 0 2.9-1.3 2.9-2.9s-1.3-2.9-2.9-2.9-2.9 1.3-2.9 2.9 1.3 2.9 2.9 2.9z" />
      <path d="M21.4 20.6c-.4-2.2-2-3.8-3.8-4.3" />
    </svg>
  );

  const IconChallenges = ({ className }: { className?: string }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5h6v2c0 2.2-1.8 4-4 4s-2-1.8-2-4V5z" />
      <path d="M9 6H6c0 2 1.5 4 3 4" />
      <path d="M15 6h3c0 2-1.5 4-3 4" />
      <path d="M12 11v2" />
      <path d="M10 21h4" />
      <path d="M9.5 17h5" />
      <path d="M5 21v-6h5v6" />
      <path d="M10 21v-8h4v8" />
      <path d="M14 21v-5h5v5" />
    </svg>
  );

  const IconSummary = ({ className }: { className?: string }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 19v-6" />
      <path d="M12 19v-9" />
      <path d="M16 19v-4" />
      <path d="M8 10l4-3 4 2 3-5" />
    </svg>
  );

  const IconMenu = ({ className }: { className?: string }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 7h14" />
      <path d="M5 12h14" />
      <path d="M5 17h14" />
    </svg>
  );

  return () => window.removeEventListener('exerciseTypeChanged', onChanged as any);
  }, []);

  const exerciseLabel = useMemo(
    () => (exerciseType === 'pushups' ? 'Отжимания' : exerciseType === 'pullups' ? 'Подтягивания' : exerciseType === 'crunches' ? 'Скручивания' : 'Приседания'),
    [exerciseType]
  );

  const setExercise = (t: 'pushups' | 'pullups' | 'crunches' | 'squats') => {
    setExerciseType(t);
    try {
      window.localStorage.setItem('exerciseType', t);
    } catch {}
    window.dispatchEvent(new CustomEvent('exerciseTypeChanged', { detail: { exerciseType: t } }));
  };

  const logout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    setMe(null);
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
            <Link href="/dashboard" style={{ fontWeight: 900, color: '#000', textDecoration: 'none' }}>
              Tracker
            </Link>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', flex: 1, padding: '0 10px' }}>
            <select
              value={exerciseType}
              onChange={handleExerciseTypeChange}
              style={{
                maxWidth: 220,
                width: '100%',
                padding: '8px 10px',
                borderRadius: 10,
                border: '1px solid #d1d5db',
                background: '#fff',
                color: '#000',
                fontWeight: 800,
              }}
              aria-label="Выбор упражнения"
            >
              <option value="pushups">Отжимания</option>
              <option value="pullups">Подтягивания</option>
                <option value="crunches">Скручивания</option>
                <option value="squats">Приседания</option>
            </select>
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
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><AvatarCircle src={me?.avatarPath ?? null} size={22} /><span>{me?.username || 'Гость'}</span></span>
            </div>
</div>
        </div>
      </header>
      <nav className="bottom-nav" role="navigation" aria-label="Нижнее меню">
        <Link className={bottomItemClass(navActive('/dashboard'))} href="/dashboard" aria-label="Домой">
          <img src="/icons/bottom-nav/home.svg" className="bottom-nav__icon" alt="" aria-hidden="true" />
          <span className="bottom-nav__label">Домой</span>
        </Link>

        <Link className={bottomItemClass(navActive('/friends'))} href="/friends" aria-label="Друзья">
          <img src="/icons/bottom-nav/friends.svg" className="bottom-nav__icon" alt="" aria-hidden="true" />
          <span className="bottom-nav__label">Друзья</span>
        </Link>

        <Link className={bottomItemClass(navActive('/challenges'))} href="/challenges" aria-label="Челленджи">
          <img src="/icons/bottom-nav/challenges.svg" className="bottom-nav__icon" alt="" aria-hidden="true" />
          <span className="bottom-nav__label">Челлендж</span>
        </Link>

        <Link className={bottomItemClass(navActive('/progress'))} href="/progress" aria-label="Сводка">
          <img src="/icons/bottom-nav/summary.svg" className="bottom-nav__icon" alt="" aria-hidden="true" />
          <span className="bottom-nav__label">Сводка</span>
        </Link>

        <button
          type="button"
          className={bottomItemClass(open)}
          onClick={() => setOpen(true)}
          aria-label="Меню"
        >
          <img src="/icons/bottom-nav/menu.svg" className="bottom-nav__icon" alt="" aria-hidden="true" />
          <span className="bottom-nav__label">Меню</span>
        </button>
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
