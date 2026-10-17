'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type CSSProperties } from 'react';
import { useI18n } from '@/i18n/provider';
import { t } from '@/i18n/translate';
import { groupHref, type GroupTab } from '@/lib/app-routes';

export type GroupSubnavView = 'overview' | GroupTab;

function viewFromPathname(pathname: string | null, groupId: string): GroupSubnavView {
  if (!pathname) return 'overview';
  const base = groupHref(groupId, undefined, 'web');
  if (pathname === `${base}/members` || pathname.startsWith(`${base}/members/`)) return 'members';
  if (pathname === `${base}/challenges`) return 'challenges';
  if (pathname === `${base}/manage`) return 'manage';
  return 'overview';
}

export default function GroupSubnavClient({
  groupId,
  groupName,
  canManage,
  memberCount,
  activeView,
}: {
  groupId: string;
  groupName: string;
  canManage: boolean;
  memberCount: number;
  /** In the app the tab comes from `?tab=`; on the site it is read from the path. */
  activeView?: GroupSubnavView;
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

  const tabs: Array<{ view: GroupSubnavView; href: string; label: string }> = [
    { view: 'overview', href: groupHref(groupId), label: tt('Обзор') },
    { view: 'members', href: groupHref(groupId, 'members'), label: tt('Участники') },
    { view: 'challenges', href: groupHref(groupId, 'challenges'), label: tt('Соревнования') },
    ...(canManage ? [{ view: 'manage' as const, href: groupHref(groupId, 'manage'), label: tt('Управление') }] : []),
  ];

  const currentView = activeView ?? viewFromPathname(pathname, groupId);

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
            const active = tab.view === currentView;
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

type GroupSummary = { name: string; canManage: boolean; members: unknown[] };

/**
 * Подменю группы в приложении: на сайте его рендерит серверный layout `groups/[id]`,
 * в статической сборке данных нет — они загружаются через API.
 */
export function GroupSubnavLoader({ groupId, activeView }: { groupId: string; activeView: GroupSubnavView }) {
  const router = useRouter();
  const [group, setGroup] = useState<{ id: string; summary: GroupSummary } | null>(null);

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}`, { cache: 'no-store', credentials: 'include' });
        if (res.status === 401) {
          if (!cancelled) router.replace('/login');
          return;
        }
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as { group?: GroupSummary } | null;
        if (!cancelled && data?.group) setGroup({ id: groupId, summary: data.group });
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, router]);

  if (!group || group.id !== groupId) return null;
  return (
    <GroupSubnavClient
      groupId={groupId}
      groupName={group.summary.name}
      canManage={group.summary.canManage}
      memberCount={group.summary.members.length}
      activeView={activeView}
    />
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
