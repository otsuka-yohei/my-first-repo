import { MessageType, UserRole, Prisma } from "@prisma/client"

import { canAccessGroup } from "@/server/auth/permissions"
import { prisma } from "@/server/db"
import { AuthorizationError, NotFoundError, DatabaseError, logError } from "@/server/errors"
import { enrichMessageInBackground, regenerateConversationSegmentsInBackground } from "./message-enrichment"

// ヘルパー関数を再エクスポート
export { regenerateMessageSuggestions } from "./conversation-helpers"

interface SessionUser {
  id: string
  role: UserRole
}

export async function ensureConversationAccess(
  user: SessionUser,
  conversation: { groupId: string; workerId: string },
) {
  if (user.role === UserRole.MEMBER) {
    if (conversation.workerId !== user.id) {
      throw new AuthorizationError("自分以外の相談は閲覧できません。")
    }
    return
  }

  if (user.role === UserRole.SYSTEM_ADMIN || user.role === UserRole.AREA_MANAGER) {
    return
  }

  const memberships = await prisma.groupMembership.findMany({
    where: { userId: user.id },
    select: { groupId: true, role: true },
  })

  const allowed = canAccessGroup(user.role, memberships, conversation.groupId)
  if (!allowed) {
    throw new AuthorizationError("このグループの相談を見る権限がありません。")
  }
}

export async function listConversationsForUser(user: SessionUser) {
  const baseInclude = {
    group: { select: { id: true, name: true } },
    worker: { select: { id: true, name: true } },
    messages: {
      orderBy: { createdAt: "desc" },
      take: 1,
      include: {
        sender: { select: { id: true, name: true, role: true } },
      },
    },
    consultation: {
      select: {
        id: true,
        status: true,
        priority: true,
        category: true,
        summary: true,
      },
    },
  } as const

  if (user.role === UserRole.MEMBER) {
    return prisma.conversation.findMany({
      where: { workerId: user.id },
      orderBy: { updatedAt: "desc" },
      include: baseInclude,
    })
  }

  if (user.role === UserRole.SYSTEM_ADMIN || user.role === UserRole.AREA_MANAGER) {
    return prisma.conversation.findMany({
      orderBy: { updatedAt: "desc" },
      include: baseInclude,
    })
  }

  const memberships = await prisma.groupMembership.findMany({
    where: { userId: user.id },
    select: { groupId: true, role: true },
  })

  const groupIds = memberships.map((membership) => membership.groupId)

  if (!groupIds.length) {
    return []
  }

  return prisma.conversation.findMany({
    where: { groupId: { in: groupIds } },
    orderBy: { updatedAt: "desc" },
    include: baseInclude,
  })
}

export async function listAvailableGroupsForWorker(user: SessionUser) {
  if (user.role !== UserRole.MEMBER) {
    return []
  }

  const memberships = await prisma.groupMembership.findMany({
    where: { userId: user.id },
    include: {
      group: {
        select: {
          id: true,
          name: true,
          isDeleted: true,
        },
      },
    },
  })

  // 削除されていないグループのみを返す
  return memberships
    .filter((membership) => !membership.group.isDeleted)
    .map((membership) => ({
      id: membership.group.id,
      name: membership.group.name,
    }))
}

export async function getConversationWithMessages(params: {
  user: SessionUser
  conversationId: string
}) {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: params.conversationId },
      include: {
        group: { select: { id: true, name: true } },
        worker: { select: { id: true, name: true, locale: true, notes: true } },
        messages: {
          orderBy: { createdAt: "asc" },
          include: {
            sender: { select: { id: true, name: true, role: true } },
            llmArtifact: true,
          },
        },
        consultation: true,
      },
    })

    if (!conversation) {
      throw new NotFoundError("Conversation")
    }

    await ensureConversationAccess(params.user, conversation)

    return conversation
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof NotFoundError) {
      throw error
    }
    logError(error, "getConversationWithMessages")
    throw new DatabaseError("会話の取得に失敗しました")
  }
}

export async function createConversation(params: {
  user: SessionUser
  groupId: string
  workerId: string
  subject?: string | null
  initialMessage?: {
    body: string
    language: string
    type?: MessageType
  }
}) {
  try {
    const worker = await prisma.user.findUnique({
      where: { id: params.workerId },
      select: { id: true, role: true },
    })

    if (!worker || worker.role !== UserRole.MEMBER) {
      throw new NotFoundError("Worker")
    }

    const group = await prisma.group.findUnique({
      where: { id: params.groupId },
      select: { id: true },
    })

    if (!group) {
      throw new NotFoundError("Group")
    }

  const workerMembership = await prisma.groupMembership.findUnique({
    where: {
      groupId_userId: {
        groupId: params.groupId,
        userId: params.workerId,
      },
    },
  })

  if (!workerMembership) {
    throw new AuthorizationError("Worker is not a member of the selected group")
  }

  if (params.user.role === UserRole.MEMBER) {
    if (params.user.id !== params.workerId) {
      throw new AuthorizationError("自分以外の相談は作成できません。")
    }
  } else if (params.user.role === UserRole.SYSTEM_ADMIN || params.user.role === UserRole.AREA_MANAGER) {
    // full access
  } else {
    const memberships = await prisma.groupMembership.findMany({
      where: { userId: params.user.id },
      select: { groupId: true, role: true },
    })

    const allowed = canAccessGroup(params.user.role, memberships, params.groupId)

    if (!allowed) {
      throw new AuthorizationError("このグループに対する作成権限がありません。")
    }
  }

    const conversation = await prisma.$transaction(async (tx) => {
      const created = await tx.conversation.create({
        data: {
          groupId: params.groupId,
          workerId: params.workerId,
          subject: params.subject ?? null,
        },
      })

      if (params.initialMessage) {
        await tx.message.create({
          data: {
            conversationId: created.id,
            senderId: params.user.id,
            body: params.initialMessage.body,
            language: params.initialMessage.language,
            type: params.initialMessage.type ?? MessageType.TEXT,
          },
        })
      }

      return created
    })

    return getConversationWithMessages({
      user: params.user,
      conversationId: conversation.id,
    })
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof NotFoundError) {
      throw error
    }
    logError(error, "createConversation")
    throw new DatabaseError("会話の作成に失敗しました")
  }
}

export async function appendMessage(params: {
  user: SessionUser & { locale?: string }
  conversationId: string
  body: string
  language: string
  type?: MessageType
  contentUrl?: string
}) {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: params.conversationId },
      include: {
        group: { select: { id: true } },
        worker: { select: { id: true, locale: true } },
      },
    })

    if (!conversation) {
      throw new NotFoundError("Conversation")
    }

  await ensureConversationAccess(params.user, conversation)

  console.log(`[appendMessage] Creating message with contentUrl: ${params.contentUrl || 'undefined'}`)

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId: params.conversationId,
        senderId: params.user.id,
        body: params.body,
        language: params.language,
        type: params.type ?? MessageType.TEXT,
        contentUrl: params.contentUrl,
      },
    })

    await tx.conversation.update({
      where: { id: params.conversationId },
      data: { updatedAt: new Date() },
    })

    return created
  })

  // メッセージを即座に取得して返す（LLM処理を待たない）
  const createdMessage = await prisma.message.findUnique({
    where: { id: message.id },
    include: {
      sender: { select: { id: true, name: true, role: true } },
      llmArtifact: true,
    },
  })

  if (!createdMessage) {
    throw new Error("Failed to load created message")
  }

  // LLM処理をバックグラウンドで実行（レスポンスを待たない）
  const targetLanguage =
    params.user.role === UserRole.MEMBER ? "ja" : conversation.worker.locale ?? "vi"
  // ワーカーがメッセージを送信した場合、マネージャーの言語はデフォルト（日本語）
  // マネージャーがメッセージを送信した場合、マネージャーのlocaleを使用
  const managerLocale = params.user.role === UserRole.MEMBER
    ? "ja"
    : (params.user as SessionUser & { locale?: string }).locale

  // すべてのメッセージでAI返信を生成（会話履歴とユーザー情報を参照）
  console.log(`[appendMessage] Calling enrichMessageInBackground with contentUrl: ${message.contentUrl ?? 'null'}`)
  void enrichMessageInBackground(
    message.id,
    params.conversationId,
    message.body,
    message.language,
    targetLanguage,
    conversation.worker.locale ?? undefined,
    managerLocale,
    params.user.role,
    message.contentUrl ?? undefined
  )

    void regenerateConversationSegmentsInBackground(params.conversationId)

    return createdMessage
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof NotFoundError) {
      throw error
    }
    logError(error, "appendMessage")
    throw new DatabaseError("メッセージの送信に失敗しました")
  }
}
