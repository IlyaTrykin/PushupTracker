'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { GroupPageClient } from '../[id]/page';
import { GroupSubnavLoader, type GroupSubnavView } from '../[id]/GroupSubnavClient';

function toView(tab: string | null): GroupSubnavView {
  return tab === 'members' || tab === 'challenges' || tab === 'manage' ? tab : 'overview';
}

function GroupView() {
  const searchParams = useSearchParams();
  const groupId = searchParams.get('id') || '';
  const view = toView(searchParams.get('tab'));
  return (
    <>
      <GroupSubnavLoader groupId={groupId} activeView={view} />
      <GroupPageClient key={`${groupId}:${view}`} view={view} />
    </>
  );
}

/** `/groups/view?id=&tab=` — группа в приложении (на сайте `/groups/<id>[/<tab>]` с серверным layout). */
export default function NativeGroupViewPage() {
  return (
    <Suspense fallback={null}>
      <GroupView />
    </Suspense>
  );
}
