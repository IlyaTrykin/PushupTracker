import { randomBytes } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthUser } from '@/lib/auth';
import { isChannelEnabledForUser } from '@/lib/notification-preferences';
import { sendGroupJoinRequestEmail, sendGroupJoinResolvedEmail } from '@/lib/notification-email';
import { queueWebPushToUsers } from '@/lib/web-push';
import { addDays, dayKeyInZone, dayKeyToDbDate } from '@/lib/calendar-day';

type DbClient = Prisma.TransactionClient | typeof prisma;
export type GroupActor = Pick<AuthUser, 'id' | 'isAdmin' | 'username'>;

const memberUserPublicSelect = {
  id: true,
  username: true,
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
  user: { select: memberUserPublicSelect },
} as const;

const joinRequestSelect = {
  id: true,
  userId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  resolvedById: true,
  user: { select: memberUserPublicSelect },
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

// Повторная заявка (в друзья или в группу) после отказа — не раньше чем через 7 дней (S05).
export const SOCIAL_RETRY_COOLDOWN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Сколько дней ещё ждать после отказа `declinedAt` (0 — можно). */
export function cooldownRetryDays(
  declinedAt: Date | null | undefined,
  now: Date,
  days = SOCIAL_RETRY_COOLDOWN_DAYS,
): number {
  if (!declinedAt) return 0;
  const leftMs = declinedAt.getTime() + days * DAY_MS - now.getTime();
  return leftMs > 0 ? Math.ceil(leftMs / DAY_MS) : 0;
}

// Заявка в друзья: «отменить и отправить снова» не должно каждый раз будить адресата —
// уведомление (in-app, push, письмо) для пары requester→target не чаще раза в 7 дней.
export function friendRequestNotifyKey(requesterId: string, targetId: string): string {
  return `friend-request:${requesterId}:${targetId}`;
}

export function shouldNotifyFriendRequest(lastNotifiedAt: Date | null | undefined, now: Date): boolean {
  return cooldownRetryDays(lastNotifiedAt, now) === 0;
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

function sendInBackground(label: string, task: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(task)
    .catch((e) => console.error(`${label}:`, e));
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

  let result: {
    request: { id: string; groupId: string; userId: string; status: string; createdAt: Date; updatedAt: Date };
    group: { id: string; name: string; ownerId: string; owner: { id: string; username: string; avatarPath: string | null } };
    notifyOwner: boolean;
  };

  try {
    result = await prisma.$transaction(async (tx) => {
      const invite = await tx.groupInviteLink.findUnique({
        where: { token },
        select: {
          token: true,
          group: { select: groupBaseSelect },
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

      const requestSelect = {
        id: true,
        groupId: true,
        userId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      } as const;
      const group = {
        id: invite.group.id,
        name: invite.group.name,
        ownerId: invite.group.ownerId,
        owner: invite.group.owner,
      };

      const existing = await tx.groupJoinRequest.findUnique({
        where: { groupId_userId: { groupId: invite.group.id, userId: actor.id } },
        select: { ...requestSelect, resolvedAt: true },
      });

      // Повторное нажатие: заявка уже ждёт — владельца заново не уведомляем.
      if (existing?.status === 'pending') {
        const pending = {
          id: existing.id,
          groupId: existing.groupId,
          userId: existing.userId,
          status: existing.status,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
        };
        return { request: pending, group, notifyOwner: false };
      }

      if (existing?.status === 'rejected') {
        const waitDays = cooldownRetryDays(existing.resolvedAt ?? existing.updatedAt, new Date());
        if (waitDays > 0) {
          throw new GroupError(
            `Заявку отклонили. Повторить можно через ${waitDays} дн.`,
            400,
            'GROUP_JOIN_REQUEST_COOLDOWN',
            { retryAfterDays: waitDays },
          );
        }
      }

      const saved = existing
        ? await tx.groupJoinRequest.update({
            where: { id: existing.id },
            data: { status: 'pending', resolvedAt: null, resolvedById: null },
            select: requestSelect,
          })
        : await tx.groupJoinRequest.create({
            data: { groupId: invite.group.id, userId: actor.id, status: 'pending' },
            select: requestSelect,
          });

      await createAuditLog(tx, {
        groupId: invite.group.id,
        actorId: actor.id,
        targetUserId: actor.id,
        action: 'group_join_requested',
        entityType: 'group_join_request',
        entityId: saved.id,
        metadata: { tokenSuffix: token.slice(-6) },
      });

      return { request: saved, group, notifyOwner: true };
    });
  } catch (e) {
    // Две одновременные заявки одного пользователя: вторая упирается в unique (groupId, userId).
    if (isUniqueViolation(e)) {
      throw new GroupError('Заявка уже отправлена', 409, 'GROUP_JOIN_REQUEST_PENDING');
    }
    throw e;
  }

  if (result.notifyOwner) {
    const title = 'Новая заявка в группу';
    const body = `${actor.username} хочет вступить в группу ${result.group.name}`;
    const link = `/groups/${result.group.id}`;

    // Уведомление пишется после транзакции: сбой здесь не должен откатывать заявку (B28).
    await prisma.notification
      .create({ data: { userId: result.group.ownerId, type: 'group_join_request', title, body, link } })
      .catch((e) => console.error('GROUP JOIN REQUEST NOTIFICATION ERROR:', e));

    queueWebPushToUsers(
      [result.group.ownerId],
      { title, body, link, tag: `group-join-request-${result.request.id}` },
      'group_join_request',
    );

    sendInBackground('GROUP JOIN REQUEST EMAIL ERROR', async () => {
      const owner = await prisma.user.findUnique({
        where: { id: result.group.ownerId },
        select: { email: true, deletedAt: true },
      });
      if (!owner?.email || owner.deletedAt) return;
      if (!(await isChannelEnabledForUser(result.group.ownerId, 'group_join_request', 'email'))) return;
      await sendGroupJoinRequestEmail({
        to: owner.email,
        ownerUsername: result.group.owner.username,
        requesterUsername: actor.username,
        groupId: result.group.id,
        groupName: result.group.name,
        request,
      });
    });
  }

  return { request: result.request, group: result.group };
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

/**
 * Добавляет участника во все ещё идущие челленджи группы (B11). «Идущий» — последний день
 * не раньше вчерашнего по UTC, чтобы не потерять челлендж, который у пользователя ещё сегодня.
 */
async function enrollInActiveGroupChallenges(db: DbClient, groupId: string, userId: string, now: Date) {
  const earliestEnd = dayKeyToDbDate(addDays(dayKeyInZone(now, 'UTC'), -1));
  const challenges = await db.challenge.findMany({
    where: { groupId, endDate: { gte: earliestEnd } },
    select: { id: true },
  });
  if (!challenges.length) return;
  await db.challengeParticipant.createMany({
    data: challenges.map((challenge) => ({ challengeId: challenge.id, userId, status: 'accepted' })),
    skipDuplicates: true,
  });
  await db.challengeParticipant.updateMany({
    where: { userId, challengeId: { in: challenges.map((challenge) => challenge.id) }, status: { not: 'accepted' } },
    data: { status: 'accepted' },
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
        user: { select: memberUserPublicSelect },
      },
    });

    if (!request) throw new GroupError('Заявка не найдена', 404, 'GROUP_JOIN_REQUEST_NOT_FOUND');
    if (request.status !== 'pending') throw new GroupError('Заявка уже обработана', 409, 'GROUP_JOIN_REQUEST_ALREADY_RESOLVED');

    const now = new Date();
    const nextStatus = action === 'approve' ? 'approved' : 'rejected';

    // Условное обновление: из двух одновременных решений проходит только первое.
    const claimed = await tx.groupJoinRequest.updateMany({
      where: { id: request.id, status: 'pending' },
      data: {
        status: nextStatus,
        resolvedAt: now,
        resolvedById: actor.id,
      },
    });
    if (claimed.count === 0) {
      throw new GroupError('Заявка уже обработана', 409, 'GROUP_JOIN_REQUEST_ALREADY_RESOLVED');
    }

    const resolved = await tx.groupJoinRequest.findUniqueOrThrow({
      where: { id: request.id },
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
      await enrollInActiveGroupChallenges(tx, group.id, request.userId, now);
    }

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

  const approved = action === 'approve';
  const eventType = approved ? 'group_join_request_approved' : 'group_join_request_rejected';
  const title = approved ? 'Заявка в группу одобрена' : 'Заявка в группу отклонена';
  const body = approved
    ? `Вы вступили в группу ${result.group.name}`
    : `Вступление в группу ${result.group.name} отклонено`;
  const link = `/groups/${result.group.id}`;

  // После транзакции (B28): сбой уведомления не откатывает решение по заявке.
  await prisma.notification
    .create({ data: { userId: result.user.id, type: eventType, title, body, link } })
    .catch((e) => console.error('GROUP JOIN RESOLVED NOTIFICATION ERROR:', e));

  queueWebPushToUsers([result.user.id], { title, body, link, tag: `group-join-${action}-${result.request.id}` }, eventType);

  sendInBackground('GROUP JOIN RESOLVED EMAIL ERROR', async () => {
    const target = await prisma.user.findUnique({
      where: { id: result.user.id },
      select: { email: true, deletedAt: true },
    });
    if (!target?.email || target.deletedAt) return;
    if (!(await isChannelEnabledForUser(result.user.id, eventType, 'email'))) return;
    await sendGroupJoinResolvedEmail({
      to: target.email,
      targetUsername: result.user.username,
      ownerUsername: actor.username,
      groupId: result.group.id,
      groupName: result.group.name,
      approved,
      request,
    });
  });

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
