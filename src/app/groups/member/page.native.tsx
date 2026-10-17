'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import GroupMemberDetailPage from '../[id]/members/[userId]/page';
import { GroupSubnavLoader } from '../[id]/GroupSubnavClient';

function GroupMemberView() {
  const searchParams = useSearchParams();
  const groupId = searchParams.get('id') || '';
  const userId = searchParams.get('userId') || '';
  return (
    <>
      <GroupSubnavLoader groupId={groupId} activeView="members" />
      <GroupMemberDetailPage key={`${groupId}:${userId}`} />
    </>
  );
}

/** `/groups/member?id=&userId=` — участник группы в приложении (на сайте `/groups/<id>/members/<userId>`). */
export default function NativeGroupMemberPage() {
  return (
    <Suspense fallback={null}>
      <GroupMemberView />
    </Suspense>
  );
}
