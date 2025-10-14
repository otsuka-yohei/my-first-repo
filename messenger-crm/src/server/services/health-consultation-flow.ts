/**
 * 健康相談フローの処理
 * conversation.tsから分離
 */

import { Prisma, MembershipRole } from "@prisma/client"

import { prisma } from "@/server/db"
import { analyzeConsultationIntent, translateMessage, type HealthConsultationAnalysis } from "@/server/llm/service"
import { searchMedicalFacilities } from "@/server/services/medical"

/**
 * システムメッセージを会話に送信（二言語対応）
 */
export async function sendSystemMessage(params: {
  conversationId: string
  body: string
  language?: string
  metadata?: Record<string, unknown>
  skipTranslation?: boolean
}): Promise<unknown> {
  try {
    console.log(`[system-message] Attempting to send system message to conversation ${params.conversationId}`)

    // システムユーザー（会話の最初のマネージャーを使用）と会話情報を取得
    const conversation = await prisma.conversation.findUnique({
      where: { id: params.conversationId },
      include: {
        worker: {
          select: { locale: true },
        },
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

    if (!conversation) {
      console.error("[system-message] Conversation not found:", params.conversationId)
      return null
    }

    if (!conversation.group.memberships[0]) {
      console.error(`[system-message] No manager found for conversation ${params.conversationId}`)
      console.warn("[system-message] System message cannot be sent without a manager in the group")
      return null
    }

    const systemSenderId = conversation.group.memberships[0].userId
    console.log(`[system-message] Using manager ${systemSenderId} as system message sender`)

    // 日本語メッセージをワーカーの言語に翻訳
    let finalBody = params.body
    const sourceLanguage = params.language || "ja"
    const workerLocale = conversation.worker.locale || "ja"

    if (!params.skipTranslation && sourceLanguage !== workerLocale) {
      try {
        console.log(`[system-message] Translating message from ${sourceLanguage} to ${workerLocale}`)
        const translationResult = await translateMessage({
          content: params.body,
          sourceLanguage,
          targetLanguage: workerLocale,
        })

        finalBody = `${params.body}\n\n---TRANSLATION---\n\n${translationResult.translation}`
        console.log(`[system-message] Translation completed`)
      } catch (error) {
        console.error("[system-message] Translation failed:", error instanceof Error ? error.message : String(error))
      }
    }

    const message = await prisma.message.create({
      data: {
        conversationId: params.conversationId,
        senderId: systemSenderId,
        body: finalBody,
        language: sourceLanguage,
        type: "SYSTEM",
        metadata: params.metadata as Prisma.InputJsonValue,
      },
    })

    await prisma.conversation.update({
      where: { id: params.conversationId },
      data: { updatedAt: new Date() },
    })

    console.log(`[system-message] Created system message ${message.id}`)

    // WebSocketで新しいシステムメッセージを配信
    if (global.io) {
      const messageWithDetails = await prisma.message.findUnique({
        where: { id: message.id },
        include: {
          sender: { select: { id: true, name: true, role: true } },
          llmArtifact: true,
        },
      })
      if (messageWithDetails) {
        global.io.to(`conversation-${params.conversationId}`).emit('new-message', {
          conversationId: params.conversationId,
          message: messageWithDetails,
        })
        console.log(`[WebSocket] Broadcasted system message ${message.id}`)
      }
    }

    return message
  } catch (error) {
    console.error("[system-message] Failed to send:", error instanceof Error ? error.message : String(error))
    return null
  }
}

/**
 * 健康相談の対話フローを処理
 */
export async function handleHealthConsultationFlow(
  conversationId: string,
  healthAnalysis: HealthConsultationAnalysis,
  currentState: string | null,
  workerAddress: string | null,
  latestWorkerMessage?: {
    body: string
    senderRole: string
  },
  conversationHistory?: Array<{
    body: string
    senderRole: string
    createdAt?: Date | string
  }>,
): Promise<boolean> {
  console.log(`[health-consultation] Starting flow for conversation ${conversationId}, current state: ${currentState || 'none'}`)

  // COMPLETEDステートの場合、新しい健康相談が検出されたらリセット
  if (currentState === "COMPLETED" && healthAnalysis.isHealthRelated) {
    console.log("[health-consultation] Resetting completed consultation for new health issue")
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        healthConsultationState: null,
        healthConsultationData: Prisma.JsonNull,
      },
    })
    currentState = null

    if (global.io) {
      global.io.to(`conversation-${conversationId}`).emit('conversation-state-updated', {
        conversationId,
        healthConsultationState: null,
      })
      console.log(`[WebSocket] Notified frontend of health consultation state reset`)
    }
  }

  // キャンセルメッセージの検出
  if (latestWorkerMessage && currentState && currentState !== "COMPLETED") {
    const cancelKeywords = ['医療相談を中止', '中止します', 'キャンセル', 'やめます', 'Tôi muốn dừng tư vấn y tế', 'Hủy bỏ tư vấn', 'Dừng tư vấn']
    const messageLower = latestWorkerMessage.body.toLowerCase().trim()
    const isCancelled = cancelKeywords.some(keyword => {
      const keywordLower = keyword.toLowerCase()
      return messageLower === keywordLower ||
             messageLower.startsWith(keywordLower) ||
             messageLower.endsWith(keywordLower) ||
             messageLower.includes(keywordLower + '。') ||
             messageLower.includes(keywordLower + '、')
    })

    if (isCancelled) {
      console.log("[health-consultation] User requested cancellation")

      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          worker: {
            select: { locale: true },
          },
        },
      })

      const workerLocale = conversation?.worker.locale || "ja"

      const cancelMessages: Record<string, string> = {
        ja: "承知しました。医療相談を中止します。\n\nまた何かございましたら、いつでもお知らせください。",
        vi: "承知しました。医療相談を中止します。\n\nまた何かございましたら、いつでもお知らせください。\n\n---TRANSLATION---\n\nĐã hiểu. Tôi sẽ dừng tư vấn y tế.\n\nNếu có gì, hãy cho tôi biết bất cứ lúc nào.",
      }

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          healthConsultationState: "COMPLETED",
        },
      })

      await sendSystemMessage({
        conversationId,
        body: cancelMessages[workerLocale] || cancelMessages.ja,
        metadata: {
          type: "health_consultation_cancelled",
          healthConsultationState: "COMPLETED",
        },
        skipTranslation: true,
      })

      return true
    }
  }

  // 初回検出：受診希望の確認
  if (!currentState && healthAnalysis.isHealthRelated) {
    console.log("[health-consultation] Initial detection - sending confirmation message")

    await sendSystemMessage({
      conversationId,
      body: "病院に行く必要がありそうですか？",
      metadata: {
        type: "health_consultation_confirmation",
        showYesNoButtons: true,
        healthAnalysis,
      },
    })

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        healthConsultationState: "WAITING_FOR_INTENT",
        healthConsultationData: healthAnalysis as unknown as Prisma.InputJsonValue,
      },
    })

    if (global.io) {
      global.io.to(`conversation-${conversationId}`).emit('conversation-state-updated', {
        conversationId,
        healthConsultationState: "WAITING_FOR_INTENT",
      })
    }

    return true
  }

  // 受診希望の判定
  if (currentState === "WAITING_FOR_INTENT" && latestWorkerMessage && conversationHistory) {
    console.log("[health-consultation] Analyzing consultation intent")

    const intentAnalysis = await analyzeConsultationIntent({
      workerMessage: latestWorkerMessage.body,
      conversationHistory,
    })

    console.log("[health-consultation] Intent analysis result:", intentAnalysis)

    if (intentAnalysis.wantsConsultation) {
      await sendSystemMessage({
        conversationId,
        body: "承知しました。\n\nもう少し詳しく教えてください。\n・いつから症状がありますか？\n・他に気になる症状はありますか？\n・痛みや辛さの程度はどのくらいですか？",
        metadata: {
          type: "health_consultation_symptom_inquiry",
          intentAnalysis,
        },
      })

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          healthConsultationState: "WAITING_FOR_SYMPTOM_DETAILS",
          healthConsultationData: {
            ...healthAnalysis,
            intentAnalysis,
          } as unknown as Prisma.InputJsonValue,
        },
      })

      if (global.io) {
        global.io.to(`conversation-${conversationId}`).emit('conversation-state-updated', {
          conversationId,
          healthConsultationState: "WAITING_FOR_SYMPTOM_DETAILS",
        })
      }

      return true
    } else {
      console.log("[health-consultation] No consultation requested - ending flow")

      await sendSystemMessage({
        conversationId,
        body: "承知しました。\n\n無理せず、もし症状が悪化したらいつでもお知らせくださいね。お大事にしてください。\n\n【医療機関の紹介は終了しました】",
        metadata: {
          type: "health_consultation_declined",
        },
      })

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          healthConsultationState: "COMPLETED",
        },
      })

      if (global.io) {
        global.io.to(`conversation-${conversationId}`).emit('conversation-state-updated', {
          conversationId,
          healthConsultationState: "COMPLETED",
        })
      }

      return true
    }
  }

  // 症状詳細の取得
  if (currentState === "WAITING_FOR_SYMPTOM_DETAILS" && latestWorkerMessage) {
    console.log("[health-consultation] Received symptom details")

    await sendSystemMessage({
      conversationId,
      body: "ありがとうございます。\n\nいつ受診したいですか？\n\n例：\n・今日の午後\n・明日の午前中\n・今週中",
      metadata: {
        type: "health_consultation_schedule_request",
      },
    })

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        healthConsultationState: "WAITING_FOR_SCHEDULE",
      },
    })

    if (global.io) {
      global.io.to(`conversation-${conversationId}`).emit('conversation-state-updated', {
        conversationId,
        healthConsultationState: "WAITING_FOR_SCHEDULE",
      })
    }

    return true
  }

  // 日時情報の取得
  if (currentState === "WAITING_FOR_SCHEDULE" && latestWorkerMessage && conversationHistory) {
    console.log("[health-consultation] Analyzing schedule preference")

    const intentAnalysis = await analyzeConsultationIntent({
      workerMessage: latestWorkerMessage.body,
      conversationHistory,
    })

    if (intentAnalysis.preferredDate || intentAnalysis.timePreference) {
      const dateStr = intentAnalysis.preferredDate === "today" ? "本日"
        : intentAnalysis.preferredDate === "tomorrow" ? "明日"
        : intentAnalysis.preferredDate === "this_week" ? "今週中"
        : intentAnalysis.specificDate || ""

      const timeStr = intentAnalysis.timePreference === "morning" ? "午前"
        : intentAnalysis.timePreference === "afternoon" ? "午後"
        : intentAnalysis.timePreference === "evening" ? "夕方"
        : ""

      await sendSystemMessage({
        conversationId,
        body: `承知しました。${dateStr}${timeStr}での受診をご希望とのことですね。\n\n近隣の医療機関を検索してお伝えします。少々お待ちください。`,
        metadata: {
          type: "health_consultation_schedule_confirmed",
          intentAnalysis,
        },
      })

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          healthConsultationState: "PROVIDING_FACILITIES",
        },
      })

      // 医療機関検索を実行
      return handleMedicalFacilitySearch(conversationId, healthAnalysis, workerAddress)
    } else {
      await sendSystemMessage({
        conversationId,
        body: "申し訳ございませんが、ご希望の日時がわかりませんでした。\n\n例：\n・今日の午後\n・明日の午前中\n・今週中\n\nのようにお知らせください。",
        metadata: {
          type: "health_consultation_schedule_unclear",
        },
      })

      return true
    }
  }

  return false
}

/**
 * 医療機関検索と情報提供
 */
async function handleMedicalFacilitySearch(
  conversationId: string,
  healthAnalysis: HealthConsultationAnalysis,
  workerAddress: string | null,
): Promise<boolean> {
  console.log("[health-consultation] Searching for medical facilities")

  if (!workerAddress) {
    await sendSystemMessage({
      conversationId,
      body: "申し訳ございませんが、住所が登録されていないため、医療機関を検索できません。\n\n設定ページから住所を登録してください。",
      metadata: {
        type: "health_consultation_no_address",
      },
    })

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        healthConsultationState: "COMPLETED",
      },
    })

    if (global.io) {
      global.io.to(`conversation-${conversationId}`).emit('conversation-state-updated', {
        conversationId,
        healthConsultationState: "COMPLETED",
      })
    }

    return true
  }

  try {
    const facilities = await searchMedicalFacilities({
      address: workerAddress,
      symptomType: healthAnalysis.symptomType || "内科",
      urgency: healthAnalysis.urgency || "flexible",
    })

    if (facilities.length > 0) {
      const facilityList = facilities.slice(0, 3).map((f, index) => {
        const lines = [`${index + 1}. **${f.name}**`]

        if (f.recommendationReasons && f.recommendationReasons.length > 0) {
          lines.push(`   💡 ${f.recommendationReasons.join('、')}`)
        }

        lines.push(`   📍 ${f.address}`)

        if (f.phoneNumber) {
          lines.push(`   📞 ${f.phoneNumber}`)
        }

        const isOpen = f.openingHours?.openNow ?? f.openNow
        if (isOpen !== undefined) {
          lines.push(`   ${isOpen ? "✅ 現在営業中" : "⏰ 営業時間外"}`)
        }

        if (f.rating) {
          lines.push(`   ⭐ 評価: ${f.rating}/5.0`)
        }

        if (f.distanceMeters !== undefined) {
          const distanceKm = (f.distanceMeters / 1000).toFixed(1)
          lines.push(`   🚶 距離: ${distanceKm}km`)
        }

        if (f.acceptsForeigners) {
          lines.push(`   🌐 外国人対応可能`)
        }

        return lines.join('\n')
      }).join('\n\n')

      const maxDistance = Math.max(...facilities.slice(0, 3).map(f => f.distanceMeters ?? 0))
      const searchRangeKm = maxDistance > 5000 ? "10km" : maxDistance > 3000 ? "5km" : "3km"

      await sendSystemMessage({
        conversationId,
        body: `近隣の医療機関を${facilities.length}件見つけました（${searchRangeKm}圏内）。以下をご検討ください：\n\n${facilityList}\n\n次のメッセージで、病院への予約電話や受診時の日本語例文をお伝えします。`,
        metadata: {
          type: "health_consultation_facilities",
          facilities: facilities.slice(0, 3),
        },
      })

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          healthConsultationState: "COMPLETED",
        },
      })

      if (global.io) {
        global.io.to(`conversation-${conversationId}`).emit('conversation-state-updated', {
          conversationId,
          healthConsultationState: "COMPLETED",
        })
      }

      return true
    } else {
      await sendSystemMessage({
        conversationId,
        body: "申し訳ございませんが、近隣の医療機関が見つかりませんでした。\n\n別の地域や症状で再度検索することもできます。何かお手伝いできることがあれば教えてください。",
        metadata: {
          type: "health_consultation_no_facilities",
        },
      })

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          healthConsultationState: "COMPLETED",
        },
      })

      if (global.io) {
        global.io.to(`conversation-${conversationId}`).emit('conversation-state-updated', {
          conversationId,
          healthConsultationState: "COMPLETED",
        })
      }

      return true
    }
  } catch (error) {
    console.error("[health-consultation] Medical facility search failed:", error)

    const errorMessage = error instanceof Error ? error.message : String(error)
    await sendSystemMessage({
      conversationId,
      body: `申し訳ございませんが、医療機関の検索中にエラーが発生しました。\n\n${errorMessage}\n\nご不明な点があればマネージャーにご相談ください。`,
      metadata: {
        type: "health_consultation_search_error",
        error: errorMessage,
      },
    })

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        healthConsultationState: "COMPLETED",
      },
    })

    if (global.io) {
      global.io.to(`conversation-${conversationId}`).emit('conversation-state-updated', {
        conversationId,
        healthConsultationState: "COMPLETED",
      })
    }

    return true
  }
}
