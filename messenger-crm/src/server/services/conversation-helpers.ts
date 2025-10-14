/**
 * 会話関連のヘルパー関数
 */

import { UserRole, Prisma } from "@prisma/client"

import { prisma } from "@/server/db"
import { enrichMessageWithLLM, analyzeImage, generateImageBasedReplies, type SuggestedReply } from "@/server/llm/service"
import { NotFoundError, DatabaseError, logError } from "@/server/errors"
import { ensureConversationAccess } from "./conversation"

interface SessionUser {
  id: string
  role: UserRole
  locale?: string
  name?: string | null
}

/**
 * メッセージのAI提案を再生成
 */
export async function regenerateMessageSuggestions(params: {
  user: SessionUser
  conversationId: string
}) {
  try {
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
      throw new NotFoundError("Conversation")
    }

    await ensureConversationAccess(params.user, conversation)

    const targetLanguage = conversation.worker?.locale ?? "vi"
    const managerLocale = params.user.locale ?? "ja"

    // メッセージがない場合は初回メッセージ用の提案を生成
    if (conversation.messages.length === 0) {
      const enrichment = await enrichMessageWithLLM({
        content: "",
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
        isInitialMessage: true,
      })

      // 仮のメッセージオブジェクトを返す
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

    // 最新のワーカーメッセージを取得
    const latestWorkerMessage = await prisma.message.findFirst({
      where: {
        conversationId: params.conversationId,
        sender: { role: UserRole.MEMBER },
      },
      orderBy: { createdAt: "desc" },
    })

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

    // 画像が含まれている場合は画像解析を実行
    let imageAnalysis = null
    if (latestWorkerMessage.contentUrl) {
      console.log(`[regenerateMessageSuggestions] Image detected: ${latestWorkerMessage.contentUrl}`)
      imageAnalysis = await analyzeImage({
        imageUrl: latestWorkerMessage.contentUrl,
        userMessage: latestWorkerMessage.body,
        workerLocale: conversation.worker?.locale ?? undefined,
      })
    }

    let suggestions: SuggestedReply[]

    if (imageAnalysis) {
      console.log(`[regenerateMessageSuggestions] Generating image-based suggestions`)
      suggestions = await generateImageBasedReplies({
        imageAnalysis,
        userMessage: latestWorkerMessage.body,
        workerInfo: {
          name: conversation.worker.name,
          locale: conversation.worker.locale,
        },
        managerLocale: managerLocale || "ja",
      })
    } else {
      const enrichment = await enrichMessageWithLLM({
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
      suggestions = enrichment.suggestions ?? []
    }

    await prisma.messageLLMArtifact.upsert({
      where: { messageId: latestWorkerMessage.id },
      update: {
        translation: imageAnalysis ? undefined : undefined,
        translationLang: imageAnalysis ? undefined : targetLanguage,
        suggestions: (suggestions ?? []) as unknown as Prisma.InputJsonValue,
        extra: imageAnalysis ? {
          imageAnalysis: imageAnalysis as unknown as Prisma.InputJsonValue,
          isImageBased: true,
        } : {},
      },
      create: {
        messageId: latestWorkerMessage.id,
        translation: undefined,
        translationLang: targetLanguage,
        suggestions: (suggestions ?? []) as unknown as Prisma.InputJsonValue,
        extra: imageAnalysis ? {
          imageAnalysis: imageAnalysis as unknown as Prisma.InputJsonValue,
          isImageBased: true,
        } : {},
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
      throw new NotFoundError("Message")
    }

    return refreshedMessage
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw error
    }
    logError(error, "regenerateMessageSuggestions")
    throw new DatabaseError("AI提案の再生成に失敗しました")
  }
}
