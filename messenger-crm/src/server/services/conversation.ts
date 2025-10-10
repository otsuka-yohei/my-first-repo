import { MessageType, UserRole, Prisma, MembershipRole } from "@prisma/client"

import { AuthorizationError, canAccessGroup } from "@/server/auth/permissions"
import { prisma } from "@/server/db"
import { enrichMessageWithLLM, segmentConversation, analyzeHealthConsultation } from "@/server/llm/service"
import { searchMedicalFacilities, type MedicalFacility } from "@/server/services/medical"

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

  if (!worker || worker.role !== UserRole.MEMBER) {
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
}

export async function appendMessage(params: {
  user: SessionUser & { locale?: string }
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
    params.user.role === UserRole.MEMBER ? "ja" : conversation.worker.locale ?? "vi"
  // ワーカーがメッセージを送信した場合、マネージャーの言語はデフォルト（日本語）
  // マネージャーがメッセージを送信した場合、マネージャーのlocaleを使用
  const managerLocale = params.user.role === UserRole.MEMBER
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

/**
 * システムメッセージを会話に送信
 */
async function sendSystemMessage(params: {
  conversationId: string
  body: string
  language?: string
  metadata?: Record<string, unknown>
}) {
  // システムユーザー（会話の最初のマネージャーを使用）
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    include: {
      group: {
        include: {
          memberships: {
            where: { role: MembershipRole.MANAGER },
            take: 1,
            include: { user: true },
          },
        },
      },
    },
  })

  if (!conversation?.group.memberships[0]) {
    console.error("[system-message] No manager found for conversation")
    return null
  }

  const systemSenderId = conversation.group.memberships[0].userId

  const message = await prisma.message.create({
    data: {
      conversationId: params.conversationId,
      senderId: systemSenderId,
      body: params.body,
      language: params.language || "ja",
      type: MessageType.SYSTEM,
      metadata: params.metadata as Prisma.InputJsonValue,
    },
  })

  await prisma.conversation.update({
    where: { id: params.conversationId },
    data: { updatedAt: new Date() },
  })

  console.log(`[system-message] Created system message ${message.id}`)
  return message
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
            notes: true,
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
    const lastWorkerMessage = sortedMessages.findLast((msg) => msg.sender.role === UserRole.MEMBER)
    let daysSinceLastWorkerMessage = 0
    if (lastWorkerMessage) {
      const timeDiff = Date.now() - new Date(lastWorkerMessage.createdAt).getTime()
      daysSinceLastWorkerMessage = timeDiff / (1000 * 60 * 60 * 24)
    } else if (senderRole !== UserRole.MEMBER) {
      // ワーカーからのメッセージがない場合は、会話開始からの経過時間
      const timeDiff = Date.now() - new Date(conversation.createdAt).getTime()
      daysSinceLastWorkerMessage = timeDiff / (1000 * 60 * 60 * 24)
    }

    // フェーズ1: 翻訳を優先実行してすぐにDB更新
    console.log(`[background] Phase 1: Priority translation for message ${messageId}`)
    const translationStartTime = Date.now()

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
        notes: conversation.worker.notes,
      },
      groupInfo: {
        name: conversation.group.name,
        phoneNumber: conversation.group.phoneNumber,
        address: conversation.group.address,
      },
      daysSinceLastWorkerMessage,
    })

    const translationDuration = Date.now() - translationStartTime
    console.log(`[background] Phase 1 completed: Translation in ${translationDuration}ms`)

    // 翻訳結果を即座にDB更新（ユーザーにすぐ表示される）
    if (enrichment.translation) {
      await prisma.messageLLMArtifact.upsert({
        where: { messageId },
        update: {
          translation: enrichment.translation.translation,
          translationLang: targetLanguage,
          extra: {
            provider: enrichment.translation.provider,
            model: enrichment.translation.model,
          } as Prisma.InputJsonValue,
        },
        create: {
          messageId,
          translation: enrichment.translation.translation,
          translationLang: targetLanguage,
          suggestions: [] as unknown as Prisma.InputJsonValue,
          extra: {
            provider: enrichment.translation.provider,
            model: enrichment.translation.model,
          } as Prisma.InputJsonValue,
        },
      })
      console.log(`[background] Translation saved to DB for immediate display`)
    }

    // フェーズ2: 健康相談の分析（並列処理なし、翻訳後に実行）
    console.log(`[background] Phase 2: Health consultation analysis for message ${messageId}`)
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

    // 健康相談で医療機関が必要な場合、自動検索してシステムメッセージを送信
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

        // 医療機関が見つかった場合、システムメッセージとして送信
        if (medicalFacilities.length > 0) {
          const facilityMessage = `近隣の医療機関を${medicalFacilities.length}件見つけました。以下の医療機関をご検討ください。`
          await sendSystemMessage({
            conversationId,
            body: facilityMessage,
            language: conversation.worker.locale || "ja",
            metadata: {
              type: "medical_facilities",
              facilities: medicalFacilities,
              healthAnalysis,
            },
          })
        }
      } catch (error) {
        console.error("[background] Failed to search medical facilities:", error)
      }
    } else if (healthAnalysis.isHealthRelated && !healthAnalysis.hasAddress) {
      // 住所が未登録の場合、システムメッセージで通知
      await sendSystemMessage({
        conversationId,
        body: "医療機関を検索するには、設定ページから住所を登録してください。",
        language: conversation.worker.locale || "ja",
        metadata: {
          type: "medical_address_required",
          healthAnalysis,
        },
      })
    }

    // フェーズ3: 提案と健康分析の結果を最終更新
    console.log(`[background] Phase 3: Final update with suggestions and health analysis`)
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
    console.log(`[background] Breakdown - Translation: ${translationDuration}ms, Total: ${duration}ms`)
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
  user: SessionUser & { locale?: string; name?: string | null }
  conversationId: string
}) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    include: {
      group: { select: { id: true, name: true, phoneNumber: true, address: true } },
      worker: {
        select: {
          id: true,
          name: true,
          locale: true,
          countryOfOrigin: true,
          dateOfBirth: true,
          gender: true,
          address: true,
          phoneNumber: true,
          jobDescription: true,
          hireDate: true,
          notes: true,
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          sender: { select: { role: true } },
        },
      },
    },
  })

  if (!conversation) {
    throw new Error("Conversation not found")
  }

  await ensureConversationAccess(params.user, conversation)

  const targetLanguage = conversation.worker?.locale ?? "vi"
  const managerLocale = params.user.locale ?? "ja"

  // メッセージがない場合は初回メッセージ用の提案を生成
  if (conversation.messages.length === 0) {
    // 初回挨拶メッセージを生成
    const enrichment = await enrichMessageWithLLM({
      content: "", // 空のコンテンツで初回メッセージを生成
      language: targetLanguage,
      targetLanguage: managerLocale,
      workerLocale: targetLanguage,
      managerLocale,
      conversationHistory: [],
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
        notes: conversation.worker.notes,
      },
      groupInfo: {
        name: conversation.group.name,
        phoneNumber: conversation.group.phoneNumber,
        address: conversation.group.address,
      },
      daysSinceLastWorkerMessage: 0,
      isInitialMessage: true, // 初回メッセージフラグ
    })

    // 仮のメッセージオブジェクトを返す（実際にはDBに保存しない）
    return {
      id: `virtual-${conversation.id}`,
      conversationId: conversation.id,
      senderId: params.user.id,
      body: "",
      language: managerLocale,
      type: "TEXT" as const,
      contentUrl: null,
      metadata: null,
      createdAt: new Date(),
      sender: {
        id: params.user.id,
        name: params.user.name ?? null,
        role: params.user.role,
      },
      llmArtifact: {
        id: `virtual-artifact-${conversation.id}`,
        messageId: `virtual-${conversation.id}`,
        translation: null,
        translationLang: null,
        suggestions: (enrichment.suggestions ?? []) as unknown as Prisma.JsonValue,
        extra: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }
  }

  // 既存のロジック：最新のワーカーメッセージから提案を生成
  const latestWorkerMessage = await prisma.message.findFirst({
    where: {
      conversationId: params.conversationId,
      sender: { role: UserRole.MEMBER },
    },
    orderBy: { createdAt: "desc" },
  })

  // ワーカーメッセージがない場合は、初回メッセージ用の提案を生成
  if (!latestWorkerMessage) {
    const enrichment = await enrichMessageWithLLM({
      content: "",
      language: managerLocale,
      targetLanguage,
      workerLocale: conversation.worker?.locale ?? undefined,
      managerLocale,
      conversationHistory: [],
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
        notes: conversation.worker.notes,
      },
      groupInfo: {
        name: conversation.group.name,
        phoneNumber: conversation.group.phoneNumber,
        address: conversation.group.address,
      },
      isInitialMessage: true,
    })

    return {
      id: `virtual-${conversation.id}`,
      conversationId: conversation.id,
      senderId: params.user.id,
      body: "",
      language: managerLocale,
      type: "TEXT" as const,
      contentUrl: null,
      metadata: null,
      createdAt: new Date(),
      sender: {
        id: params.user.id,
        name: params.user.name ?? null,
        role: params.user.role,
      },
      llmArtifact: {
        id: `virtual-artifact-${conversation.id}`,
        messageId: `virtual-${conversation.id}`,
        translation: null,
        translationLang: null,
        suggestions: (enrichment.suggestions ?? []) as unknown as Prisma.JsonValue,
        extra: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }
  }

  let enrichment: Awaited<ReturnType<typeof enrichMessageWithLLM>>
  try {
    enrichment = await enrichMessageWithLLM({
      content: latestWorkerMessage.body,
      language: latestWorkerMessage.language,
      targetLanguage,
      workerLocale: conversation.worker?.locale ?? undefined,
      managerLocale,
      conversationHistory: conversation.messages.reverse().map((msg) => ({
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
        notes: conversation.worker.notes,
      },
      groupInfo: {
        name: conversation.group.name,
        phoneNumber: conversation.group.phoneNumber,
        address: conversation.group.address,
      },
      daysSinceLastWorkerMessage: 0,
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
