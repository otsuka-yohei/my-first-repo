import { UserRole } from "@prisma/client"

import { AuthorizationError } from "@/server/auth/permissions"
import { prisma } from "@/server/db"

interface SessionUser {
  id: string
  role: UserRole
}

/**
 * グループ一覧を取得
 */
export async function listGroups(user: SessionUser, includeDeleted = false) {
  const whereClause = includeDeleted ? {} : { isDeleted: false }

  if (user.role === UserRole.SYSTEM_ADMIN || user.role === UserRole.AREA_MANAGER) {
    // システム管理者とエリアマネージャーは全グループを閲覧可能
    return prisma.group.findMany({
      where: whereClause,
      include: {
        organization: { select: { id: true, name: true } },
        _count: {
          select: {
            memberships: true,
            conversations: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    })
  }

  // マネージャーとワーカーは所属グループのみ閲覧可能
  const memberships = await prisma.groupMembership.findMany({
    where: { userId: user.id },
    select: { groupId: true },
  })

  const groupIds = memberships.map((m) => m.groupId)

  if (groupIds.length === 0) {
    return []
  }

  return prisma.group.findMany({
    where: { id: { in: groupIds }, ...whereClause },
    include: {
      organization: { select: { id: true, name: true } },
      _count: {
        select: {
          memberships: true,
          conversations: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })
}

/**
 * グループを作成（システム管理者のみ）
 */
export async function createGroup(params: {
  user: SessionUser
  name: string
  description?: string
  organizationId: string
}) {
  if (params.user.role !== UserRole.SYSTEM_ADMIN) {
    throw new AuthorizationError("グループの作成はシステム管理者のみ可能です。")
  }

  // 組織の存在確認
  const organization = await prisma.organization.findUnique({
    where: { id: params.organizationId },
  })

  if (!organization) {
    throw new Error("指定された組織が見つかりません。")
  }

  return prisma.group.create({
    data: {
      name: params.name,
      description: params.description ?? null,
      organizationId: params.organizationId,
    },
    include: {
      organization: { select: { id: true, name: true } },
      _count: {
        select: {
          memberships: true,
          conversations: true,
        },
      },
    },
  })
}

/**
 * グループを更新（システム管理者のみ）
 */
export async function updateGroup(params: {
  user: SessionUser
  groupId: string
  name?: string
  description?: string
}) {
  if (params.user.role !== UserRole.SYSTEM_ADMIN) {
    throw new AuthorizationError("グループの更新はシステム管理者のみ可能です。")
  }

  const group = await prisma.group.findUnique({
    where: { id: params.groupId },
  })

  if (!group) {
    throw new Error("指定されたグループが見つかりません。")
  }

  return prisma.group.update({
    where: { id: params.groupId },
    data: {
      name: params.name ?? undefined,
      description: params.description !== undefined ? params.description : undefined,
    },
    include: {
      organization: { select: { id: true, name: true } },
      _count: {
        select: {
          memberships: true,
          conversations: true,
        },
      },
    },
  })
}

/**
 * グループを論理削除（システム管理者のみ）
 */
export async function softDeleteGroup(params: { user: SessionUser; groupId: string }) {
  if (params.user.role !== UserRole.SYSTEM_ADMIN) {
    throw new AuthorizationError("グループの削除はシステム管理者のみ可能です。")
  }

  const group = await prisma.group.findUnique({
    where: { id: params.groupId, isDeleted: false },
  })

  if (!group) {
    throw new Error("指定されたグループが見つかりません。")
  }

  return prisma.group.update({
    where: { id: params.groupId },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      deletedBy: params.user.id,
    },
    include: {
      organization: { select: { id: true, name: true } },
      _count: {
        select: {
          memberships: true,
          conversations: true,
        },
      },
    },
  })
}

/**
 * グループを復元（システム管理者のみ）
 */
export async function restoreGroup(params: { user: SessionUser; groupId: string }) {
  if (params.user.role !== UserRole.SYSTEM_ADMIN) {
    throw new AuthorizationError("グループの復元はシステム管理者のみ可能です。")
  }

  const group = await prisma.group.findUnique({
    where: { id: params.groupId, isDeleted: true },
  })

  if (!group) {
    throw new Error("指定されたグループが見つかりません。")
  }

  return prisma.group.update({
    where: { id: params.groupId },
    data: {
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
    },
    include: {
      organization: { select: { id: true, name: true } },
      _count: {
        select: {
          memberships: true,
          conversations: true,
        },
      },
    },
  })
}

/**
 * 会話とメンバーを別グループに移行（システム管理者のみ）
 */
export async function migrateGroupData(params: {
  user: SessionUser
  fromGroupId: string
  toGroupId: string
  migrateConversations: boolean
  migrateMembers: boolean
}) {
  if (params.user.role !== UserRole.SYSTEM_ADMIN) {
    throw new AuthorizationError("グループデータの移行はシステム管理者のみ可能です。")
  }

  const [fromGroup, toGroup] = await Promise.all([
    prisma.group.findUnique({ where: { id: params.fromGroupId } }),
    prisma.group.findUnique({ where: { id: params.toGroupId } }),
  ])

  if (!fromGroup) {
    throw new Error("移行元のグループが見つかりません。")
  }

  if (!toGroup) {
    throw new Error("移行先のグループが見つかりません。")
  }

  const result = await prisma.$transaction(async (tx) => {
    let conversationsMigrated = 0
    let membersMigrated = 0

    // 会話を移行
    if (params.migrateConversations) {
      const updateResult = await tx.conversation.updateMany({
        where: { groupId: params.fromGroupId },
        data: { groupId: params.toGroupId },
      })
      conversationsMigrated = updateResult.count
    }

    // メンバーを移行（重複を避ける）
    if (params.migrateMembers) {
      const fromMembers = await tx.groupMembership.findMany({
        where: { groupId: params.fromGroupId },
        select: { userId: true, role: true },
      })

      const toMembers = await tx.groupMembership.findMany({
        where: { groupId: params.toGroupId },
        select: { userId: true },
      })

      const toMemberIds = new Set(toMembers.map((m) => m.userId))

      // 移行先に存在しないメンバーのみ追加
      for (const member of fromMembers) {
        if (!toMemberIds.has(member.userId)) {
          await tx.groupMembership.create({
            data: {
              groupId: params.toGroupId,
              userId: member.userId,
              role: member.role,
            },
          })
          membersMigrated++
        }
      }

      // 移行元のメンバーシップを削除
      await tx.groupMembership.deleteMany({
        where: { groupId: params.fromGroupId },
      })
    }

    return { conversationsMigrated, membersMigrated }
  })

  return result
}

/**
 * 組織一覧を取得（システム管理者のみ）
 */
export async function listOrganizations(user: SessionUser) {
  if (user.role !== UserRole.SYSTEM_ADMIN) {
    throw new AuthorizationError("組織一覧の取得はシステム管理者のみ可能です。")
  }

  return prisma.organization.findMany({
    orderBy: { name: "asc" },
  })
}
