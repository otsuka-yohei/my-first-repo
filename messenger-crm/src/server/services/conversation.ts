import { MessageType, UserRole, Prisma } from "@prisma/client"

import { AuthorizationError, canAccessGroup } from "@/server/auth/permissions"
import { prisma } from "@/server/db"
import { enrichMessageWithLLM, segmentConversation, generateFollowUpSuggestions, analyzeHealthConsultation } from "@/server/llm/service"
import { searchMedicalFacilities, type MedicalFacility } from "@/server/services/medical"

interface SessionUser {
  id: string
  role: UserRole
}

export async function ensureConversationAccess(
  user: SessionUser,
  conversation: { groupId: string; workerId: string },
) {
  if (user.role === UserRole.WORKER) {
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

  if (user.role === UserRole.WORKER) {
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

export async function getConversationWithMessages(params: {
  user: SessionUser
  conversationId: string
}) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    include: {
      group: { select: { id: true, name: true } },
      worker: { select: { id: true, name: true, locale: true } },
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
    throw new Error("Conversation not found")
  }

  await ensureConversationAccess(params.user, conversation)

  return conversation
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
  const worker = await prisma.user.findUnique({
    where: { id: params.workerId },
    select: { id: true, role: true },
  })

  if (!worker || worker.role !== UserRole.WORKER) {
    throw new Error("Worker not found")
  }

  const group = await prisma.group.findUnique({
    where: { id: params.groupId },
    select: { id: true },
  })

  if (!group) {
    throw new Error("Group not found")
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

  if (params.user.role === UserRole.WORKER) {
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
}

export async function appendMessage(params: {
  user: SessionUser
  conversationId: string
  body: string
  language: string
  type?: MessageType
}) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    include: {
      group: { select: { id: true } },
      worker: { select: { id: true, locale: true } },
    },
  })

  if (!conversation) {
    throw new Error("Conversation not found")
  }

  await ensureConversationAccess(params.user, conversation)

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId: params.conversationId,
        senderId: params.user.id,
        body: params.body,
        language: params.language,
        type: params.type ?? MessageType.TEXT,
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
    params.user.role === UserRole.WORKER ? "ja" : conversation.worker.locale ?? "vi"
  // ワーカーがメッセージを送信した場合、マネージャーの言語はデフォルト（日本語）
  // マネージャーがメッセージを送信した場合、マネージャーのlocaleを使用
  const managerLocale = params.user.role === UserRole.WORKER
    ? "ja"
    : (params.user as SessionUser & { locale?: string }).locale

  // すべてのメッセージでAI返信を生成（会話履歴とユーザー情報を参照）
  void enrichMessageInBackground(
    message.id,
    params.conversationId,
    message.body,
    message.language,
    targetLanguage,
    conversation.worker.locale ?? undefined,
    managerLocale,
    params.user.role
  )

  void regenerateConversationSegmentsInBackground(params.conversationId)

  return createdMessage
}

async function enrichMessageInBackground(
  messageId: string,
  conversationId: string,
  content: string,
  language: string,
  targetLanguage: string,
  workerLocale?: string,
  managerLocale?: string,
  senderRole?: UserRole,
) {
  try {
    console.log(`[background] Starting LLM enrichment for message ${messageId}`)
    const startTime = Date.now()

    // 会話履歴とworker情報を取得
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        worker: {
          select: {
            name: true,
            locale: true,
            countryOfOrigin: true,
            dateOfBirth: true,
            gender: true,
            address: true,
            phoneNumber: true,
            jobDescription: true,
            hireDate: true,
          },
        },
        group: {
          select: {
            name: true,
            phoneNumber: true,
            address: true,
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 10, // 直近10件
          include: {
            sender: { select: { role: true } },
          },
        },
      },
    })

    if (!conversation) {
      console.log(`[background] Conversation ${conversationId} not found`)
      return
    }

    // メッセージを時系列順に並べ替え
    const sortedMessages = [...conversation.messages].reverse()

    // 最後のワーカーメッセージからの経過時間を計算
    const lastWorkerMessage = sortedMessages.findLast((msg) => msg.sender.role === UserRole.WORKER)
    let daysSinceLastWorkerMessage = 0
    if (lastWorkerMessage) {
      const timeDiff = Date.now() - new Date(lastWorkerMessage.createdAt).getTime()
      daysSinceLastWorkerMessage = timeDiff / (1000 * 60 * 60 * 24)
    } else if (senderRole !== UserRole.WORKER) {
      // ワーカーからのメッセージがない場合は、会話開始からの経過時間
      const timeDiff = Date.now() - new Date(conversation.createdAt).getTime()
      daysSinceLastWorkerMessage = timeDiff / (1000 * 60 * 60 * 24)
    }

    const enrichment = await enrichMessageWithLLM({
      content,
      language,
      targetLanguage,
      workerLocale,
      managerLocale,
      conversationHistory: sortedMessages.map((msg) => ({
        body: msg.body,
        senderRole: msg.sender.role,
        createdAt: msg.createdAt,
      })),
      workerInfo: {
        name: conversation.worker.name,
        locale: conversation.worker.locale,
        countryOfOrigin: conversation.worker.countryOfOrigin,
        dateOfBirth: conversation.worker.dateOfBirth,
        gender: conversation.worker.gender,
        address: conversation.worker.address,
        phoneNumber: conversation.worker.phoneNumber,
        jobDescription: conversation.worker.jobDescription,
        hireDate: conversation.worker.hireDate,
      },
      groupInfo: {
        name: conversation.group.name,
        phoneNumber: conversation.group.phoneNumber,
        address: conversation.group.address,
      },
      daysSinceLastWorkerMessage,
    })

    // 健康相談の分析
    let medicalFacilities: MedicalFacility[] | undefined
    const healthAnalysis = await analyzeHealthConsultation({
      conversationHistory: sortedMessages.map((msg) => ({
        body: msg.body,
        senderRole: msg.sender.role,
        createdAt: msg.createdAt,
      })),
      workerInfo: {
        address: conversation.worker.address,
      },
    })

    console.log("[background] Health consultation analysis:", healthAnalysis)

    // 健康相談で医療機関が必要な場合、自動検索
    if (
      healthAnalysis.isHealthRelated &&
      healthAnalysis.needsMedicalFacility &&
      healthAnalysis.hasAddress &&
      conversation.worker.address
    ) {
      try {
        console.log("[background] Searching medical facilities for worker")
        medicalFacilities = await searchMedicalFacilities({
          address: conversation.worker.address,
          symptomType: healthAnalysis.symptomType,
          urgency: healthAnalysis.urgency,
        })
        console.log(`[background] Found ${medicalFacilities.length} medical facilities`)
      } catch (error) {
        console.error("[background] Failed to search medical facilities:", error)
      }
    }

    const extraData: Record<string, unknown> = {
      provider: enrichment.translation?.provider,
      model: enrichment.translation?.model,
    }

    if (healthAnalysis.isHealthRelated) {
      extraData.healthAnalysis = healthAnalysis
    }

    if (medicalFacilities && medicalFacilities.length > 0) {
      extraData.medicalFacilities = medicalFacilities
    }

    await prisma.messageLLMArtifact.upsert({
      where: { messageId },
      update: {
        translation: enrichment.translation?.translation,
        translationLang: targetLanguage,
        suggestions: (enrichment.suggestions ?? []) as unknown as Prisma.InputJsonValue,
        extra: extraData as Prisma.InputJsonValue,
      },
      create: {
        messageId,
        translation: enrichment.translation?.translation,
        translationLang: targetLanguage,
        suggestions: (enrichment.suggestions ?? []) as unknown as Prisma.InputJsonValue,
        extra: extraData as Prisma.InputJsonValue,
      },
    })

    const duration = Date.now() - startTime
    console.log(`[background] LLM enrichment completed for message ${messageId} in ${duration}ms`)
  } catch (error) {
    console.error(`[background] Failed to enrich message ${messageId}:`, error)
  }
}


async function regenerateConversationSegmentsInBackground(conversationId: string) {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: {
            sender: { select: { role: true } },
          },
        },
      },
    })

    if (!conversation || conversation.messages.length === 0) {
      return
    }

    const messagesForLLM = conversation.messages.map((msg) => ({
      id: msg.id,
      body: msg.body,
      language: msg.language,
      senderRole: msg.sender.role,
      createdAt: msg.createdAt,
    }))

    const segments = await segmentConversation({ messages: messagesForLLM })

    await prisma.$transaction(async (tx) => {
      await tx.conversationSegment.deleteMany({
        where: { conversationId },
      })

      await tx.conversationSegment.createMany({
        data: segments.map((segment) => ({
          conversationId,
          title: segment.title,
          summary: segment.summary,
          messageIds: segment.messageIds,
          startedAt: segment.startedAt,
          endedAt: segment.endedAt,
        })),
      })
    })
  } catch (error) {
    console.error("Failed to regenerate conversation segments in background", error)
  }
}

export async function regenerateMessageSuggestions(params: {
  user: SessionUser
  conversationId: string
}) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    include: {
      group: { select: { id: true } },
      worker: { select: { id: true, locale: true } },
    },
  })

  if (!conversation) {
    throw new Error("Conversation not found")
  }

  await ensureConversationAccess(params.user, conversation)

  const latestWorkerMessage = await prisma.message.findFirst({
    where: {
      conversationId: params.conversationId,
      sender: { role: UserRole.WORKER },
    },
    orderBy: { createdAt: "desc" },
  })

  if (!latestWorkerMessage) {
    throw new Error("No worker message available for suggestions")
  }

  const targetLanguage = conversation.worker?.locale ?? "vi"
  const managerLocale = (params.user as SessionUser & { locale?: string }).locale ?? "ja"

  let enrichment: Awaited<ReturnType<typeof enrichMessageWithLLM>>
  try {
    enrichment = await enrichMessageWithLLM({
      content: latestWorkerMessage.body,
      language: latestWorkerMessage.language,
      targetLanguage,
      workerLocale: conversation.worker?.locale ?? undefined,
      managerLocale,
    })
  } catch (error) {
    console.error("Failed to regenerate message suggestions", error)
    throw new Error("Failed to regenerate message suggestions")
  }

  await prisma.messageLLMArtifact.upsert({
    where: { messageId: latestWorkerMessage.id },
    update: {
      translation: enrichment.translation?.translation,
      translationLang: targetLanguage,
      suggestions: (enrichment.suggestions ?? []) as unknown as Prisma.InputJsonValue,
      extra: {
        provider: enrichment.translation?.provider,
        model: enrichment.translation?.model,
      },
    },
    create: {
      messageId: latestWorkerMessage.id,
      translation: enrichment.translation?.translation,
      translationLang: targetLanguage,
      suggestions: (enrichment.suggestions ?? []) as unknown as Prisma.InputJsonValue,
      extra: {
        provider: enrichment.translation?.provider,
        model: enrichment.translation?.model,
      },
    },
  })

  const refreshedMessage = await prisma.message.findUnique({
    where: { id: latestWorkerMessage.id },
    include: {
      sender: { select: { id: true, name: true, role: true } },
      llmArtifact: true,
    },
  })

  if (!refreshedMessage) {
    throw new Error("Failed to load regenerated message")
  }

  return refreshedMessage
}
