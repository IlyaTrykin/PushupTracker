import { randomBytes } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthUser } from '@/lib/auth';
import { isChannelEnabledForUser } from '@/lib/notification-preferences';
import { sendGroupJoinRequestEmail, sendGroupJoinResolvedEmail } from '@/lib/notification-email';
import { sendWebPushToUsers } from '@/lib/web-push';

type DbClient = Prisma.TransactionClient | typeof prisma;
export type GroupActor = Pick<AuthUser, 'id' | 'isAdmin' | 'username'>;

const memberUserSelect = {
  id: true,
  username: true,
  email: true,
  avatarPath: true,
} as const;

const groupBaseSelect = {
  id: true,
  name: true,
  ownerId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  owner: {
    select: {
      id: true,
      username: true,
      avatarPath: true,
    },
  },
} as const;

const groupMemberSelect = {
  id: true,
  userId: true,
  status: true,
  includeInStats: true,
  joinedAt: true,
  leftAt: true,
  removedAt: true,
  createdAt: true,
  updatedAt: true,
  user: { select: memberUserSelect },
} as const;

const joinRequestSelect = {
  id: true,
  userId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  resolvedById: true,
  user: { select: memberUserSelect },
} as const;

const auditLogSelect = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  metadata: true,
  createdAt: true,
  actorId: true,
  targetUserId: true,
  actor: {
    select: {
      id: true,
      username: true,
      avatarPath: true,
    },
  },
  targetUser: {
    select: {
      id: true,
      username: true,
      avatarPath: true,
    },
  },
} as const;

export class GroupError extends Error {
  public status: number;
  public code?: string;
  public details?: Record<string, unknown>;

  constructor(message: string, status = 400, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function normalizeGroupName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function assertValidGroupName(name: string): void {
  if (!name) throw new GroupError('Название группы обязательно', 400, 'GROUP_NAME_REQUIRED');
  if (name.length > 120) throw new GroupError('Название группы слишком длинное', 400, 'GROUP_NAME_TOO_LONG');
}

function makeInviteToken(): string {
  return randomBytes(24).toString('base64url');
}

async function createAuditLog(
  db: DbClient,
  input: {
    groupId: string;
    actorId?: string | null;
    targetUserId?: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Prisma.InputJsonValue | null;
  },
) {
  await db.groupAuditLog.create({
    data: {
      groupId: input.groupId,
      actorId: input.actorId ?? null,
      targetUserId: input.targetUserId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? undefined,
    },
  });
}

async function getActiveMemberCounts(db: DbClient, groupIds: string[]) {
  if (!groupIds.length) return new Map<string, number>();
  const rows = await db.groupMembership.groupBy({
    by: ['groupId'],
    where: { groupId: { in: groupIds }, status: 'active' },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.groupId, row._count._all]));
}

async function getPendingRequestCounts(db: DbClient, groupIds: string[]) {
  if (!groupIds.length) return new Map<string, number>();
  const rows = await db.groupJoinRequest.groupBy({
    by: ['groupId'],
    where: { groupId: { in: groupIds }, status: 'pending' },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.groupId, row._count._all]));
}

async function getGroupOrThrow(db: DbClient, groupId: string) {
  const group = await db.group.findFirst({
    where: { id: groupId, deletedAt: null },
    select: groupBaseSelect,
  });

  if (!group) throw new GroupError('Группа не найдена', 404, 'GROUP_NOT_FOUND');
  return group;
}

export async function requireGroupAccess(db: DbClient, actor: GroupActor, groupId: string) {
  const group = await getGroupOrThrow(db, groupId);
  if (actor.isAdmin) return group;

  const membership = await db.groupMembership.findUnique({
    where: { groupId_userId: { groupId, userId: actor.id } },
    select: { status: true },
  });

  if (!membership || membership.status !== 'active') {
    throw new GroupError('Нет доступа к группе', 403, 'GROUP_ACCESS_DENIED');
  }

  return group;
}

export async function requireGroupManageAccess(db: DbClient, actor: GroupActor, groupId: string) {
  const group = await getGroupOrThrow(db, groupId);
  if (actor.isAdmin || group.ownerId === actor.id) return group;
  throw new GroupError('Нет прав на управление группой', 403, 'GROUP_MANAGE_DENIED');
}

async function requireActiveMember(db: DbClient, groupId: string, userId: string) {
  const membership = await db.groupMembership.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: groupMemberSelect,
  });

  if (!membership || membership.status !== 'active') {
    throw new GroupError('Участник группы не найден', 404, 'GROUP_MEMBER_NOT_FOUND');
  }

  return membership;
}

export async function requireManagedGroupMemberAccess(actor: GroupActor, groupId: string, targetUserId: string) {
  const group = await requireGroupManageAccess(prisma, actor, groupId);
  const membership = await requireActiveMember(prisma, groupId, targetUserId);
  return { group, membership };
}

export async function recordGroupAuditLog(input: {
  groupId: string;
  actorId?: string | null;
  targetUserId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}) {
  await createAuditLog(prisma, input);
}

export async function getGroupWorkoutScope(actor: GroupActor, groupId: string) {
  const group = await requireGroupAccess(prisma, actor, groupId);
  const memberships = await prisma.groupMembership.findMany({
    where: {
      groupId: group.id,
      status: 'active',
    },
    orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
    select: {
      userId: true,
      user: {
        select: {
          id: true,
          username: true,
          avatarPath: true,
        },
      },
    },
  });

  return {
    group,
    members: memberships,
    userIds: memberships.map((membership) => membership.userId),
  };
}

export async function listGroupsForUser(actor: GroupActor) {
  const groups = await prisma.group.findMany({
    where: actor.isAdmin
      ? { deletedAt: null }
      : {
          deletedAt: null,
          memberships: {
            some: {
              userId: actor.id,
              status: 'active',
            },
          },
        },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      ...groupBaseSelect,
      memberships: {
        where: { userId: actor.id },
        select: { status: true, joinedAt: true, createdAt: true },
        take: 1,
      },
    },
  });

  const groupIds = groups.map((group) => group.id);
  const [memberCounts, pendingCounts] = await Promise.all([
    getActiveMemberCounts(prisma, groupIds),
    getPendingRequestCounts(prisma, groupIds),
  ]);

  return groups.map((group) => {
    const myMembership = group.memberships[0] ?? null;
    const canManage = actor.isAdmin || group.ownerId === actor.id;
    return {
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      owner: group.owner,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      myMembershipStatus: myMembership?.status ?? null,
      joinedAt: myMembership?.joinedAt ?? myMembership?.createdAt ?? null,
      memberCount: memberCounts.get(group.id) ?? 0,
      pendingRequestCount: canManage ? pendingCounts.get(group.id) ?? 0 : 0,
      canManage,
      isOwner: group.ownerId === actor.id,
    };
  });
}

export async function createGroup(actor: GroupActor, rawName: unknown) {
  const name = normalizeGroupName(rawName);
  assertValidGroupName(name);

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const group = await tx.group.create({
      data: {
        name,
        ownerId: actor.id,
      },
      select: { id: true, name: true, ownerId: true, createdAt: true, updatedAt: true },
    });

    await tx.groupMembership.create({
      data: {
        groupId: group.id,
        userId: actor.id,
        status: 'active',
        joinedAt: now,
      },
    });

    const inviteLink = await tx.groupInviteLink.create({
      data: {
        groupId: group.id,
        token: makeInviteToken(),
      },
      select: { token: true },
    });

    await createAuditLog(tx, {
      groupId: group.id,
      actorId: actor.id,
      action: 'group_created',
      entityType: 'group',
      entityId: group.id,
      metadata: { name },
    });

    return {
      ...group,
      inviteToken: inviteLink.token,
      canManage: true,
      isOwner: true,
      memberCount: 1,
      pendingRequestCount: 0,
    };
  });
}

export async function getGroupDetails(actor: GroupActor, groupId: string) {
  const group = await requireGroupAccess(prisma, actor, groupId);
  const canManage = actor.isAdmin || group.ownerId === actor.id;

  const detail = await prisma.group.findFirst({
    where: { id: group.id, deletedAt: null },
    select: {
      ...groupBaseSelect,
      memberships: {
        where: { status: 'active' },
        orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
        select: groupMemberSelect,
      },
      inviteLink: { select: { token: true, updatedAt: true } },
    },
  });

  if (!detail) throw new GroupError('Группа не найдена', 404, 'GROUP_NOT_FOUND');

  const pendingRequests = canManage
    ? await prisma.groupJoinRequest.findMany({
        where: {
          groupId: detail.id,
          status: 'pending',
          group: { deletedAt: null },
        },
        orderBy: { createdAt: 'asc' },
        select: joinRequestSelect,
      })
    : [];

  return {
    id: detail.id,
    name: detail.name,
    ownerId: detail.ownerId,
    owner: detail.owner,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    canManage,
    isOwner: detail.ownerId === actor.id,
    memberCount: detail.memberships.length,
    pendingRequestCount: pendingRequests.length,
    inviteToken: canManage && detail.inviteLink ? detail.inviteLink.token : null,
    inviteUpdatedAt: canManage && detail.inviteLink ? detail.inviteLink.updatedAt : null,
    members: detail.memberships.map((membership) => ({
      id: membership.id,
      userId: membership.userId,
      status: membership.status,
      includeInStats: membership.includeInStats,
      joinedAt: membership.joinedAt ?? membership.createdAt,
      user: membership.user,
      isOwner: detail.ownerId === membership.userId,
    })),
    pendingRequests: pendingRequests.map((request) => ({
      id: request.id,
      userId: request.userId,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      resolvedAt: request.resolvedAt,
      resolvedById: request.resolvedById,
      user: request.user,
    })),
  };
}

export async function rotateGroupInviteLink(actor: GroupActor, groupId: string) {
  return prisma.$transaction(async (tx) => {
    const group = await requireGroupManageAccess(tx, actor, groupId);
    const token = makeInviteToken();

    const inviteLink = await tx.groupInviteLink.upsert({
      where: { groupId: group.id },
      update: { token },
      create: {
        groupId: group.id,
        token,
      },
      select: {
        token: true,
        updatedAt: true,
      },
    });

    await createAuditLog(tx, {
      groupId: group.id,
      actorId: actor.id,
      action: 'group_invite_rotated',
      entityType: 'group_invite_link',
      entityId: group.id,
      metadata: { tokenSuffix: token.slice(-6) },
    });

    return inviteLink;
  });
}

export async function updateGroupName(actor: GroupActor, groupId: string, rawName: unknown) {
  const name = normalizeGroupName(rawName);
  assertValidGroupName(name);

  return prisma.$transaction(async (tx) => {
    const group = await requireGroupManageAccess(tx, actor, groupId);
    const updated = await tx.group.update({
      where: { id: group.id },
      data: { name },
      select: {
        id: true,
        name: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await createAuditLog(tx, {
      groupId: group.id,
      actorId: actor.id,
      action: 'group_updated',
      entityType: 'group',
      entityId: group.id,
      metadata: { name },
    });

    return updated;
  });
}

export async function submitJoinRequest(actor: GroupActor, rawToken: unknown, request?: Request) {
  const token = String(rawToken ?? '').trim();
  if (!token) throw new GroupError('Ссылка-приглашение недействительна', 400, 'GROUP_INVITE_INVALID');

  const result = await prisma.$transaction(async (tx) => {
    const invite = await tx.groupInviteLink.findUnique({
      where: { token },
      select: {
        token: true,
        group: {
          select: {
            ...groupBaseSelect,
            owner: {
              select: {
                id: true,
                username: true,
                avatarPath: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!invite?.group || invite.group.deletedAt) {
      throw new GroupError('Ссылка-приглашение недействительна', 404, 'GROUP_INVITE_NOT_FOUND');
    }

    const membership = await tx.groupMembership.findUnique({
      where: { groupId_userId: { groupId: invite.group.id, userId: actor.id } },
      select: { status: true },
    });

    if (membership?.status === 'active') {
      throw new GroupError('Вы уже состоите в этой группе', 409, 'GROUP_ALREADY_MEMBER');
    }

    const request = await tx.groupJoinRequest.upsert({
      where: {
        groupId_userId: {
          groupId: invite.group.id,
          userId: actor.id,
        },
      },
      update: {
        status: 'pending',
        resolvedAt: null,
        resolvedById: null,
      },
      create: {
        groupId: invite.group.id,
        userId: actor.id,
        status: 'pending',
      },
      select: {
        id: true,
        groupId: true,
        userId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await tx.notification.create({
      data: {
        userId: invite.group.ownerId,
        type: 'group_join_request',
        title: 'Новая заявка в группу',
        body: `${actor.username} хочет вступить в группу ${invite.group.name}`,
        link: `/groups/${invite.group.id}`,
      },
    }).catch(() => {});

    await createAuditLog(tx, {
      groupId: invite.group.id,
      actorId: actor.id,
      targetUserId: actor.id,
      action: 'group_join_requested',
      entityType: 'group_join_request',
      entityId: request.id,
      metadata: { tokenSuffix: token.slice(-6) },
    });

    return {
      request,
      group: {
        id: invite.group.id,
        name: invite.group.name,
        ownerId: invite.group.ownerId,
        owner: invite.group.owner,
      },
    };
  });

  try {
    await sendWebPushToUsers(
      [result.group.ownerId],
      {
        title: 'Новая заявка в группу',
        body: `${actor.username} хочет вступить в группу ${result.group.name}`,
        link: `/groups/${result.group.id}`,
        tag: `group-join-request-${result.request.id}`,
      },
      'group_join_request',
    );

    if (result.group.owner.email && (await isChannelEnabledForUser(result.group.ownerId, 'group_join_request', 'email'))) {
      await sendGroupJoinRequestEmail({
        to: result.group.owner.email,
        ownerUsername: result.group.owner.username,
        requesterUsername: actor.username,
        groupId: result.group.id,
        groupName: result.group.name,
        request,
      });
    }
  } catch (e) {
    console.error('GROUP JOIN REQUEST NOTIFY ERROR:', e);
  }

  return result;
}

export async function listPendingJoinRequests(actor: GroupActor, groupId: string) {
  await requireGroupManageAccess(prisma, actor, groupId);

  return prisma.groupJoinRequest.findMany({
    where: {
      groupId,
      status: 'pending',
      group: { deletedAt: null },
    },
    orderBy: { createdAt: 'asc' },
    select: joinRequestSelect,
  });
}

export async function resolveJoinRequest(
  actor: GroupActor,
  groupId: string,
  requestId: string,
  action: 'approve' | 'reject',
  request?: Request,
) {
  const result = await prisma.$transaction(async (tx) => {
    const group = await requireGroupManageAccess(tx, actor, groupId);
    const request = await tx.groupJoinRequest.findFirst({
      where: {
        id: requestId,
        groupId: group.id,
        group: { deletedAt: null },
      },
      select: {
        id: true,
        groupId: true,
        userId: true,
        status: true,
        user: { select: memberUserSelect },
      },
    });

    if (!request) throw new GroupError('Заявка не найдена', 404, 'GROUP_JOIN_REQUEST_NOT_FOUND');
    if (request.status !== 'pending') throw new GroupError('Заявка уже обработана', 409, 'GROUP_JOIN_REQUEST_ALREADY_RESOLVED');

    const now = new Date();
    const nextStatus = action === 'approve' ? 'approved' : 'rejected';

    const resolved = await tx.groupJoinRequest.update({
      where: { id: request.id },
      data: {
        status: nextStatus,
        resolvedAt: now,
        resolvedById: actor.id,
      },
      select: {
        id: true,
        groupId: true,
        userId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        resolvedById: true,
      },
    });

    if (action === 'approve') {
      await tx.groupMembership.upsert({
        where: {
          groupId_userId: {
            groupId: group.id,
            userId: request.userId,
          },
        },
        update: {
          status: 'active',
          includeInStats: true,
          joinedAt: now,
          leftAt: null,
          removedAt: null,
        },
        create: {
          groupId: group.id,
          userId: request.userId,
          status: 'active',
          includeInStats: true,
          joinedAt: now,
        },
      });
    }

    await tx.notification.create({
      data: {
        userId: request.userId,
        type: action === 'approve' ? 'group_join_request_approved' : 'group_join_request_rejected',
        title: action === 'approve' ? 'Заявка в группу одобрена' : 'Заявка в группу отклонена',
        body:
          action === 'approve'
            ? `Вы вступили в группу ${group.name}`
            : `Вступление в группу ${group.name} отклонено`,
        link: `/groups/${group.id}`,
      },
    }).catch(() => {});

    await createAuditLog(tx, {
      groupId: group.id,
      actorId: actor.id,
      targetUserId: request.userId,
      action: action === 'approve' ? 'group_join_approved' : 'group_join_rejected',
      entityType: 'group_join_request',
      entityId: request.id,
    });

    return {
      request: resolved,
      group: {
        id: group.id,
        name: group.name,
      },
      user: request.user,
    };
  });

  try {
    const approved = action === 'approve';
    await sendWebPushToUsers(
      [result.user.id],
      {
        title: approved ? 'Заявка в группу одобрена' : 'Заявка в группу отклонена',
        body: approved
          ? `Вы вступили в группу ${result.group.name}`
          : `Вступление в группу ${result.group.name} отклонено`,
        link: `/groups/${result.group.id}`,
        tag: `group-join-${action}-${result.request.id}`,
      },
      approved ? 'group_join_request_approved' : 'group_join_request_rejected',
    );

    if (
      result.user.email &&
      (await isChannelEnabledForUser(
        result.user.id,
        approved ? 'group_join_request_approved' : 'group_join_request_rejected',
        'email',
      ))
    ) {
      await sendGroupJoinResolvedEmail({
        to: result.user.email,
        targetUsername: result.user.username,
        ownerUsername: actor.username,
        groupId: result.group.id,
        groupName: result.group.name,
        approved,
        request,
      });
    }
  } catch (e) {
    console.error('GROUP JOIN RESOLVED NOTIFY ERROR:', e);
  }

  return result;
}

export async function leaveGroup(actor: GroupActor, groupId: string) {
  return prisma.$transaction(async (tx) => {
    const group = await requireGroupAccess(tx, actor, groupId);
    if (group.ownerId === actor.id) {
      const remainingMembers = await tx.groupMembership.count({
        where: {
          groupId,
          status: 'active',
          userId: { not: actor.id },
        },
      });

      throw new GroupError(
        remainingMembers > 0
          ? 'Передайте права владельца другому участнику или удалите группу'
          : 'Владелец последнего участника должен удалить группу',
        409,
        'GROUP_OWNER_CANNOT_LEAVE',
        { remainingMembers },
      );
    }

    const now = new Date();
    await requireActiveMember(tx, group.id, actor.id);

    await tx.groupMembership.update({
      where: { groupId_userId: { groupId: group.id, userId: actor.id } },
      data: {
        status: 'left',
        leftAt: now,
      },
    });

    await createAuditLog(tx, {
      groupId: group.id,
      actorId: actor.id,
      targetUserId: actor.id,
      action: 'group_left',
      entityType: 'group_membership',
      entityId: actor.id,
    });

    return { ok: true };
  });
}

export async function removeGroupMember(actor: GroupActor, groupId: string, targetUserId: string) {
  return prisma.$transaction(async (tx) => {
    const group = await requireGroupManageAccess(tx, actor, groupId);
    if (group.ownerId === targetUserId) {
      throw new GroupError('Нельзя исключить владельца группы без передачи прав', 400, 'GROUP_OWNER_REMOVE_FORBIDDEN');
    }

    const now = new Date();
    const membership = await requireActiveMember(tx, group.id, targetUserId);

    await tx.groupMembership.update({
      where: { id: membership.id },
      data: {
        status: 'removed',
        removedAt: now,
      },
    });

    await createAuditLog(tx, {
      groupId: group.id,
      actorId: actor.id,
      targetUserId,
      action: 'group_member_removed',
      entityType: 'group_membership',
      entityId: membership.id,
    });

    return { ok: true };
  });
}

export async function updateGroupMemberStatsInclusion(
  actor: GroupActor,
  groupId: string,
  targetUserId: string,
  includeInStatsInput: unknown,
) {
  if (typeof includeInStatsInput !== 'boolean') {
    throw new GroupError('Некорректное значение флага статистики', 400, 'GROUP_MEMBER_STATS_FLAG_INVALID');
  }

  return prisma.$transaction(async (tx) => {
    const group = await requireGroupManageAccess(tx, actor, groupId);
    const membership = await requireActiveMember(tx, group.id, targetUserId);

    const updated = await tx.groupMembership.update({
      where: { id: membership.id },
      data: { includeInStats: includeInStatsInput },
      select: {
        id: true,
        groupId: true,
        userId: true,
        includeInStats: true,
        status: true,
        joinedAt: true,
        updatedAt: true,
      },
    });

    await createAuditLog(tx, {
      groupId: group.id,
      actorId: actor.id,
      targetUserId,
      action: 'group_member_stats_inclusion_updated',
      entityType: 'group_membership',
      entityId: membership.id,
      metadata: { includeInStats: includeInStatsInput },
    });

    return updated;
  });
}

export async function transferGroupOwnership(actor: GroupActor, groupId: string, nextOwnerId: string) {
  if (!nextOwnerId) throw new GroupError('Не выбран новый владелец группы', 400, 'GROUP_NEW_OWNER_REQUIRED');

  return prisma.$transaction(async (tx) => {
    const group = await requireGroupManageAccess(tx, actor, groupId);
    if (group.ownerId === nextOwnerId) throw new GroupError('Этот пользователь уже является владельцем', 400, 'GROUP_OWNER_ALREADY_SET');

    await requireActiveMember(tx, group.id, nextOwnerId);

    const updated = await tx.group.update({
      where: { id: group.id },
      data: { ownerId: nextOwnerId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await createAuditLog(tx, {
      groupId: group.id,
      actorId: actor.id,
      targetUserId: nextOwnerId,
      action: 'group_owner_transferred',
      entityType: 'group',
      entityId: group.id,
      metadata: { previousOwnerId: group.ownerId, nextOwnerId },
    });

    return updated;
  });
}

export async function deleteGroup(actor: GroupActor, groupId: string) {
  return prisma.$transaction(async (tx) => {
    const group = await requireGroupManageAccess(tx, actor, groupId);
    const now = new Date();

    await tx.group.update({
      where: { id: group.id },
      data: { deletedAt: now },
    });

    await tx.groupMembership.updateMany({
      where: {
        groupId: group.id,
        status: 'active',
      },
      data: {
        status: 'removed',
        removedAt: now,
      },
    });

    await tx.groupJoinRequest.updateMany({
      where: {
        groupId: group.id,
        status: 'pending',
      },
      data: {
        status: 'rejected',
        resolvedAt: now,
        resolvedById: actor.id,
      },
    });

    await createAuditLog(tx, {
      groupId: group.id,
      actorId: actor.id,
      action: 'group_deleted',
      entityType: 'group',
      entityId: group.id,
    });

    return { ok: true, deletedAt: now };
  });
}

export async function listGroupAuditLogs(actor: GroupActor, groupId: string, limit = 50) {
  await requireGroupManageAccess(prisma, actor, groupId);

  return prisma.groupAuditLog.findMany({
    where: { groupId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    select: auditLogSelect,
  });
}
