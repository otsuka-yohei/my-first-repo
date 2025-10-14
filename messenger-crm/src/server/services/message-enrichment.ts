/**
 * メッセージエンリッチメント（翻訳とAI提案）のバックグラウンド処理
 * conversation.tsから分離
 */

import { Prisma, UserRole } from "@prisma/client"

import { prisma } from "@/server/db"
import {
  translateMessage,
  generateSuggestedReplies,
  analyzeHealthConsultation,
  analyzeImage,
  generateImageBasedReplies,
  type SuggestedReply,
  type EnhancedSuggestionRequest,
} from "@/server/llm/service"
import { logError } from "@/server/errors"
import { handleHealthConsultationFlow } from "./health-consultation-flow"

/**
 * メッセージをLLMで拡張（バックグラウンド実行）
 */
export async function enrichMessageInBackground(
  messageId: string,
  conversationId: string,
  content: string,
  language: string,
  targetLanguage: string,
  workerLocale?: string,
  managerLocale?: string,
  senderRole?: UserRole,
  contentUrl?: string,
): Promise<void> {
  try {
    console.log(`[background] Starting LLM enrichment for message ${messageId}`)
    const startTime = Date.now()

    // 会話情報を取得
    const conversation = await fetchConversationData(conversationId)
    if (!conversation) {
      console.log(`[background] Conversation ${conversationId} not found`)
      return
    }

    // Phase 1: 翻訳の即時実行
    const translation = await performTranslation(
      messageId,
      conversationId,
      content,
      language,
      targetLanguage,
    )

    // Phase 2: 画像解析（画像がある場合）
    const imageAnalysis = contentUrl
      ? await analyzeImage({
          imageUrl: contentUrl,
          userMessage: content,
          workerLocale: conversation.worker.locale ?? undefined,
        })
      : null

    if (imageAnalysis) {
      console.log(`[background] Image analysis completed:`, imageAnalysis)
    }

    // メッセージを時系列順に並べ替え
    const sortedMessages = [...conversation.messages].reverse()

    // 最後のワーカーメッセージからの経過時間を計算
    const daysSinceLastWorkerMessage = calculateDaysSinceLastWorkerMessage(sortedMessages, senderRole)

    // Phase 3: 健康相談分析（ワーカーからのメッセージの場合）
    let healthConsultationInProgress = false
    if (senderRole === UserRole.MEMBER) {
      healthConsultationInProgress = await handleHealthConsultation(
        conversationId,
        sortedMessages,
        conversation.worker.address,
        conversation.healthConsultationState,
      )
    }

    // Phase 4: AI提案生成（健康相談中でない場合）
    const suggestions = await generateSuggestions(
      healthConsultationInProgress,
      imageAnalysis,
      content,
      sortedMessages,
      conversation,
      managerLocale,
      workerLocale,
      daysSinceLastWorkerMessage,
    )

    // Phase 5: 最終更新
    await updateMessageArtifact(
      messageId,
      translation,
      targetLanguage,
      suggestions,
      healthConsultationInProgress,
      imageAnalysis,
    )

    const duration = Date.now() - startTime
    console.log(`[background] LLM enrichment completed for message ${messageId} in ${duration}ms`)

    // WebSocketで最終更新を通知
    await broadcastMessageUpdate(conversationId, messageId)
  } catch (error) {
    logError(error, `enrichMessageInBackground(${messageId})`)
  }
}

/**
 * 会話データを取得
 */
async function fetchConversationData(conversationId: string) {
  return prisma.conversation.findUnique({
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
        take: 10,
        include: {
          sender: { select: { role: true } },
        },
      },
    },
  })
}

/**
 * 翻訳を実行してDBに即座に保存
 */
async function performTranslation(
  messageId: string,
  conversationId: string,
  content: string,
  language: string,
  targetLanguage: string,
) {
  if (!content || language === targetLanguage) {
    return undefined
  }

  console.log(`[background] Phase 1: Immediate translation`)
  const translationStartTime = Date.now()

  const translation = await translateMessage({
    content,
    sourceLanguage: language,
    targetLanguage,
  })

  const translationDuration = Date.now() - translationStartTime
  console.log(`[background] Phase 1 completed: Translation in ${translationDuration}ms`)

  // 翻訳結果を即座にDB更新
  await prisma.messageLLMArtifact.upsert({
    where: { messageId },
    update: {
      translation: translation.translation,
      translationLang: targetLanguage,
      extra: {
        provider: translation.provider,
        model: translation.model,
      } as Prisma.InputJsonValue,
    },
    create: {
      messageId,
      translation: translation.translation,
      translationLang: targetLanguage,
      suggestions: [] as unknown as Prisma.InputJsonValue,
      extra: {
        provider: translation.provider,
        model: translation.model,
      } as Prisma.InputJsonValue,
    },
  })

  console.log(`[background] Translation saved to DB for immediate display`)

  // WebSocketで翻訳完了を通知
  await broadcastMessageUpdate(conversationId, messageId)

  return translation
}

/**
 * 最後のワーカーメッセージからの経過日数を計算
 */
function calculateDaysSinceLastWorkerMessage(
  sortedMessages: Array<{ sender: { role: string }; createdAt: Date }>,
  senderRole?: UserRole,
): number {
  const lastWorkerMessage = sortedMessages.findLast((msg) => msg.sender.role === UserRole.MEMBER)

  if (lastWorkerMessage) {
    const timeDiff = Date.now() - new Date(lastWorkerMessage.createdAt).getTime()
    return timeDiff / (1000 * 60 * 60 * 24)
  } else if (senderRole !== UserRole.MEMBER) {
    // ワーカーからのメッセージがない場合は、現在時刻から計算
    return 0
  }

  return 0
}

/**
 * 健康相談フローの処理
 */
async function handleHealthConsultation(
  conversationId: string,
  sortedMessages: Array<{ body: string; sender: { role: string }; createdAt: Date }>,
  workerAddress: string | null,
  currentState: string | null,
): Promise<boolean> {
  console.log(`[background] Phase 2: Health consultation analysis`)

  try {
    const healthAnalysis = await analyzeHealthConsultation({
      conversationHistory: sortedMessages.map((msg) => ({
        body: msg.body,
        senderRole: msg.sender.role,
        createdAt: msg.createdAt,
      })),
      workerInfo: {
        address: workerAddress,
      },
    })

    console.log("[background] Health consultation analysis completed:", healthAnalysis)

    if (healthAnalysis && healthAnalysis.isHealthRelated) {
      // 最新のステートをデータベースから取得
      const latestConversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { healthConsultationState: true },
      })
      const latestState = latestConversation?.healthConsultationState || currentState

      const shouldHandleFlow = !latestState ||
                               latestState === "WAITING_FOR_INTENT" ||
                               latestState === "WAITING_FOR_SYMPTOM_DETAILS" ||
                               latestState === "WAITING_FOR_SCHEDULE" ||
                               latestState === "COMPLETED"

      if (shouldHandleFlow) {
        const latestWorkerMsg = sortedMessages
          .filter(msg => msg.sender.role === UserRole.MEMBER)
          .slice(-1)[0]

        await handleHealthConsultationFlow(
          conversationId,
          healthAnalysis,
          latestState,
          workerAddress,
          latestWorkerMsg ? {
            body: latestWorkerMsg.body,
            senderRole: latestWorkerMsg.sender.role,
          } : undefined,
          sortedMessages.map(msg => ({
            body: msg.body,
            senderRole: msg.sender.role,
          })),
        )

        console.log("[background] Health consultation flow initiated")
        return true
      }
    }

    return false
  } catch (error) {
    logError(error, "handleHealthConsultation")
    return false
  }
}

/**
 * AI提案を生成
 */
async function generateSuggestions(
  healthConsultationInProgress: boolean,
  imageAnalysis: Awaited<ReturnType<typeof analyzeImage>>,
  content: string,
  sortedMessages: Array<{ body: string; sender: { role: string }; createdAt: Date }>,
  conversation: NonNullable<Awaited<ReturnType<typeof fetchConversationData>>>,
  managerLocale?: string,
  workerLocale?: string,
  daysSinceLastWorkerMessage?: number,
): Promise<SuggestedReply[]> {
  console.log(`[background] Phase 3: AI suggestion generation`)

  if (healthConsultationInProgress) {
    console.log("[background] Phase 3 skipped: Health consultation in progress")
    return []
  }

  try {
    // 画像がある場合は画像ベースの提案を生成
    if (imageAnalysis) {
      console.log(`[background] Generating image-based suggestions`)
      return await generateImageBasedReplies({
        imageAnalysis,
        userMessage: content,
        workerInfo: {
          name: conversation.worker.name,
          locale: conversation.worker.locale,
        },
        managerLocale: managerLocale || "ja",
      })
    }

    // 通常の提案生成
    return await generateSuggestedReplies({
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
      language: managerLocale || "ja",
      persona: "manager",
      targetTranslationLanguage: workerLocale !== managerLocale ? workerLocale : undefined,
      daysSinceLastWorkerMessage,
    } as EnhancedSuggestionRequest)
  } catch (error) {
    logError(error, "generateSuggestions")
    return []
  }
}

/**
 * メッセージアーティファクトを更新
 */
async function updateMessageArtifact(
  messageId: string,
  translation: Awaited<ReturnType<typeof translateMessage>> | undefined,
  targetLanguage: string,
  suggestions: SuggestedReply[],
  healthConsultationInProgress: boolean,
  imageAnalysis: Awaited<ReturnType<typeof analyzeImage>>,
) {
  console.log(`[background] Phase 4: Final update with suggestions`)

  const extraData: Record<string, unknown> = {
    provider: translation?.provider,
    model: translation?.model,
    healthConsultationInProgress,
  }

  if (imageAnalysis) {
    extraData.imageAnalysis = imageAnalysis
  }

  await prisma.messageLLMArtifact.upsert({
    where: { messageId },
    update: {
      suggestions: (suggestions ?? []) as unknown as Prisma.InputJsonValue,
      extra: extraData as Prisma.InputJsonValue,
    },
    create: {
      messageId,
      translation: translation?.translation,
      translationLang: targetLanguage,
      suggestions: (suggestions ?? []) as unknown as Prisma.InputJsonValue,
      extra: extraData as Prisma.InputJsonValue,
    },
  })
}

/**
 * WebSocketでメッセージ更新を配信
 */
async function broadcastMessageUpdate(conversationId: string, messageId: string) {
  if (!global.io) {
    return
  }

  const updatedMessage = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      sender: { select: { id: true, name: true, role: true } },
      llmArtifact: true,
    },
  })

  if (updatedMessage) {
    global.io.to(`conversation-${conversationId}`).emit('message-updated', {
      conversationId,
      message: updatedMessage,
    })
    console.log(`[WebSocket] Broadcasted update for message ${messageId}`)
  }
}

/**
 * 会話セグメントを再生成（バックグラウンド実行）
 */
export async function regenerateConversationSegmentsInBackground(conversationId: string): Promise<void> {
  try {
    const { segmentConversation } = await import("@/server/llm/service")

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
    logError(error, "regenerateConversationSegmentsInBackground")
  }
}
