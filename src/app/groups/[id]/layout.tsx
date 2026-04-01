import { cookies } from 'next/headers';
import GroupSubnavClient from './GroupSubnavClient';
import { getAuthUserFromSessionToken } from '@/lib/auth';
import { getGroupDetails } from '@/lib/groups';

export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const actor = await getAuthUserFromSessionToken(cookieStore.get('session')?.value);

  let groupName = '';
  let canManage = false;
  let memberCount = 0;

  if (actor) {
    try {
      const group = await getGroupDetails(actor, id);
      groupName = group.name;
      canManage = group.canManage;
      memberCount = group.members.length;
    } catch {}
  }

  return (
    <>
      {groupName ? <GroupSubnavClient groupId={id} groupName={groupName} canManage={canManage} memberCount={memberCount} /> : null}
      {children}
    </>
  );
}
