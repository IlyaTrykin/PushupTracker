import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import GroupSubnavClient from './GroupSubnavClient';
import { getAuthUserFromSessionToken } from '@/lib/auth';
import { getGroupDetails, GroupError } from '@/lib/groups';

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
  if (!actor) redirect('/login');

  let group;
  try {
    group = await getGroupDetails(actor, id);
  } catch (error) {
    if (error instanceof GroupError) {
      if (error.code === 'GROUP_NOT_FOUND') notFound();
      if (error.code === 'GROUP_ACCESS_DENIED') notFound();
    }

    throw error;
  }

  return (
    <>
      <GroupSubnavClient
        groupId={id}
        groupName={group.name}
        canManage={group.canManage}
        memberCount={group.members.length}
      />
      {children}
    </>
  );
}
