CREATE TABLE "Group" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupMembership" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "joinedAt" TIMESTAMP(3),
  "leftAt" TIMESTAMP(3),
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GroupMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupJoinRequest" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GroupJoinRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupInviteLink" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GroupInviteLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupAuditLog" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "actorId" TEXT,
  "targetUserId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GroupAuditLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Challenge" ADD COLUMN "groupId" TEXT;
ALTER TABLE "TrainingProgram" ADD COLUMN "managedByGroupId" TEXT;
ALTER TABLE "TrainingProgram" ADD COLUMN "assignedByUserId" TEXT;

CREATE INDEX "Group_ownerId_createdAt_idx" ON "Group"("ownerId", "createdAt");
CREATE INDEX "Group_deletedAt_createdAt_idx" ON "Group"("deletedAt", "createdAt");

CREATE UNIQUE INDEX "GroupMembership_groupId_userId_key" ON "GroupMembership"("groupId", "userId");
CREATE INDEX "GroupMembership_userId_status_updatedAt_idx" ON "GroupMembership"("userId", "status", "updatedAt");
CREATE INDEX "GroupMembership_groupId_status_updatedAt_idx" ON "GroupMembership"("groupId", "status", "updatedAt");

CREATE UNIQUE INDEX "GroupJoinRequest_groupId_userId_key" ON "GroupJoinRequest"("groupId", "userId");
CREATE INDEX "GroupJoinRequest_groupId_status_createdAt_idx" ON "GroupJoinRequest"("groupId", "status", "createdAt");
CREATE INDEX "GroupJoinRequest_userId_status_createdAt_idx" ON "GroupJoinRequest"("userId", "status", "createdAt");

CREATE UNIQUE INDEX "GroupInviteLink_groupId_key" ON "GroupInviteLink"("groupId");
CREATE UNIQUE INDEX "GroupInviteLink_token_key" ON "GroupInviteLink"("token");

CREATE INDEX "GroupAuditLog_groupId_createdAt_idx" ON "GroupAuditLog"("groupId", "createdAt");
CREATE INDEX "GroupAuditLog_targetUserId_createdAt_idx" ON "GroupAuditLog"("targetUserId", "createdAt");

CREATE INDEX "Challenge_groupId_createdAt_idx" ON "Challenge"("groupId", "createdAt");
CREATE INDEX "TrainingProgram_managedByGroupId_userId_isActive_idx" ON "TrainingProgram"("managedByGroupId", "userId", "isActive");

ALTER TABLE "Group" ADD CONSTRAINT "Group_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupJoinRequest" ADD CONSTRAINT "GroupJoinRequest_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupJoinRequest" ADD CONSTRAINT "GroupJoinRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupInviteLink" ADD CONSTRAINT "GroupInviteLink_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupAuditLog" ADD CONSTRAINT "GroupAuditLog_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupAuditLog" ADD CONSTRAINT "GroupAuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GroupAuditLog" ADD CONSTRAINT "GroupAuditLog_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TrainingProgram" ADD CONSTRAINT "TrainingProgram_managedByGroupId_fkey"
  FOREIGN KEY ("managedByGroupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingProgram" ADD CONSTRAINT "TrainingProgram_assignedByUserId_fkey"
  FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
