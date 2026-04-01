'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type CSSProperties } from 'react';
import { useI18n } from '@/i18n/provider';
import { t } from '@/i18n/translate';

export default function GroupSubnavClient({
  groupId,
  groupName,
  canManage,
  memberCount,
}: {
  groupId: string;
  groupName: string;
  canManage: boolean;
  memberCount: number;
}) {
  const pathname = usePathname();
  const { locale } = useI18n();
  const tt = (input: string) => t(locale, input);

  useEffect(() => {
    const title = `${t(locale, 'Группа')}: ${groupName} (${memberCount})`;
    window.dispatchEvent(new CustomEvent('appPageTitleOverride', { detail: { title } }));
    return () => {
      window.dispatchEvent(new CustomEvent('appPageTitleOverride', { detail: { title: null } }));
    };
  }, [groupName, locale, memberCount, pathname]);

  const tabs = [
    { href: `/groups/${groupId}`, label: tt('Обзор') },
    { href: `/groups/${groupId}/members`, label: tt('Участники') },
    { href: `/groups/${groupId}/challenges`, label: tt('Соревнования') },
    ...(canManage ? [{ href: `/groups/${groupId}/manage`, label: tt('Управление') }] : []),
  ];

  const activeHref = (() => {
    if (!pathname) return `/groups/${groupId}`;
    if (pathname.startsWith(`/groups/${groupId}/members/`) || pathname === `/groups/${groupId}/members`) return `/groups/${groupId}/members`;
    if (pathname === `/groups/${groupId}/challenges`) return `/groups/${groupId}/challenges`;
    if (pathname === `/groups/${groupId}/manage`) return `/groups/${groupId}/manage`;
    return `/groups/${groupId}`;
  })();

  return (
    <>
      <div style={spacer} aria-hidden="true" />
      <div style={wrap}>
        <div
          style={{
            ...shell,
            gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
          }}
        >
          {tabs.map((tab) => {
            const active = tab.href === activeHref;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                style={{
                  ...tabLink,
                  ...(active ? tabLinkActive : {}),
                }}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}

const spacer: CSSProperties = {
  height: 'clamp(52px, 9vw, 64px)',
};

const wrap: CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  top: 'calc(var(--safe-top, 0px) + clamp(76px, 9vw, 84px))',
  zIndex: 45,
  padding: '0 clamp(10px, 2.8vw, 16px)',
};

const shell: CSSProperties = {
  maxWidth: 1080,
  margin: '0 auto',
  padding: '6px',
  borderRadius: 20,
  border: '1px solid rgba(226, 232, 240, 0.95)',
  background: 'rgba(255,255,255,0.94)',
  backdropFilter: 'saturate(180%) blur(12px)',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)',
  display: 'grid',
  gap: 6,
  alignItems: 'stretch',
};

const tabLink: CSSProperties = {
  minWidth: 0,
  padding: 'clamp(8px, 2.2vw, 10px) clamp(10px, 2.6vw, 14px)',
  borderRadius: 14,
  textDecoration: 'none',
  color: '#0f172a',
  fontSize: 'clamp(12px, 2.9vw, 13px)',
  fontWeight: 800,
  textAlign: 'center',
  lineHeight: 1.15,
  background: 'transparent',
};

const tabLinkActive: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(15,118,110,0.14) 0%, rgba(16,185,129,0.08) 100%)',
  color: '#0f766e',
};
