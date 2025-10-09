import { UserRole } from "@prisma/client"

import { prisma } from "@/server/db"

interface SessionUser {
  id: string
  role: UserRole
}

export interface SearchParams {
  query: string
  searchMessages?: boolean
  searchUsers?: boolean
  searchTags?: boolean
  limit?: number
}

/**
 * 統合検索機能
 */
export async function search(user: SessionUser, params: SearchParams) {
  const { query, searchMessages = true, searchUsers = false, searchTags = false, limit = 50 } = params

  if (!query || query.trim().length === 0) {
    return {
      messages: [],
      users: [],
      tags: [],
    }
  }

  const searchQuery = query.trim().toLowerCase()

  // アクセス可能なグループIDを取得
  let allowedGroupIds: string[] = []
  if (user.role !== UserRole.SYSTEM_ADMIN && user.role !== UserRole.AREA_MANAGER) {
    if (user.role === UserRole.WORKER) {
      // WORKERは自分の会話のみ
      const messages = await prisma.message.findMany({
        where: {
          body: {
            contains: searchQuery,
            mode: "insensitive",
          },
          conversation: {
            workerId: user.id,
          },
        },
        include: {
          sender: {
            select: { name: true, role: true },
          },
          conversation: {
            select: {
              id: true,
              subject: true,
              worker: { select: { name: true } },
              group: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      })

      return {
        messages,
        users: [],
        tags: [],
      }
    }

    const memberships = await prisma.groupMembership.findMany({
      where: { userId: user.id },
      select: { groupId: true },
    })
    allowedGroupIds = memberships.map((m) => m.groupId)
  }

  const results: {
    messages: unknown[]
    users: unknown[]
    tags: unknown[]
  } = {
    messages: [],
    users: [],
    tags: [],
  }

  // メッセージ検索
  if (searchMessages) {
    const messageWhere =
      user.role === UserRole.SYSTEM_ADMIN || user.role === UserRole.AREA_MANAGER
        ? {
            body: {
              contains: searchQuery,
              mode: "insensitive" as const,
            },
          }
        : {
            body: {
              contains: searchQuery,
              mode: "insensitive" as const,
            },
            conversation: {
              groupId: { in: allowedGroupIds },
            },
          }

    results.messages = await prisma.message.findMany({
      where: messageWhere,
      include: {
        sender: {
          select: { name: true, role: true },
        },
        conversation: {
          select: {
            id: true,
            subject: true,
            worker: { select: { name: true } },
            group: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    })
  }

  // ユーザー検索
  if (searchUsers) {
    const userWhere =
      user.role === UserRole.SYSTEM_ADMIN || user.role === UserRole.AREA_MANAGER
        ? {
            OR: [
              {
                name: {
                  contains: searchQuery,
                  mode: "insensitive" as const,
                },
              },
              {
                email: {
                  contains: searchQuery,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {
            OR: [
              {
                name: {
                  contains: searchQuery,
                  mode: "insensitive" as const,
                },
              },
              {
                email: {
                  contains: searchQuery,
                  mode: "insensitive" as const,
                },
              },
            ],
            memberships: {
              some: {
                groupId: { in: allowedGroupIds },
              },
            },
          }

    results.users = await prisma.user.findMany({
      where: userWhere,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        memberships: {
          include: {
            group: {
              select: { name: true },
            },
          },
        },
      },
      take: limit,
    })
  }

  // タグ検索（相談ケースのカテゴリ）
  if (searchTags) {
    const consultationWhere =
      user.role === UserRole.SYSTEM_ADMIN || user.role === UserRole.AREA_MANAGER
        ? {
            category: {
              contains: searchQuery,
              mode: "insensitive" as const,
            },
          }
        : {
            category: {
              contains: searchQuery,
              mode: "insensitive" as const,
            },
            conversation: {
              groupId: { in: allowedGroupIds },
            },
          }

    results.tags = await prisma.consultationCase.findMany({
      where: consultationWhere,
      include: {
        conversation: {
          select: {
            id: true,
            subject: true,
            worker: { select: { name: true } },
            group: { select: { name: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    })
  }

  return results
}
