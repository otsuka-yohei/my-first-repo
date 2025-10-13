import { MessageType, UserRole, Prisma, MembershipRole } from "@prisma/client"

import { AuthorizationError, canAccessGroup } from "@/server/auth/permissions"
import { prisma } from "@/server/db"
import { enrichMessageWithLLM, segmentConversation, analyzeHealthConsultation, translateMessage, generateSuggestedReplies, analyzeConsultationIntent, type SuggestedReply, type EnhancedSuggestionRequest } from "@/server/llm/service"
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
 * 健康相談の対話フローを処理
 */
async function handleHealthConsultationFlow(
  conversationId: string,
  healthAnalysis: Awaited<ReturnType<typeof analyzeHealthConsultation>>,
  currentState: string | null,
  workerAddress: string | null,
  latestWorkerMessage?: {
    body: string
    senderRole: string
  },
  conversationHistory?: Array<{
    body: string
    senderRole: string
  }>,
) {
  console.log(`[health-consultation] Starting flow for conversation ${conversationId}, current state: ${currentState || 'none'}`)

  // COMPLETEDステートの場合、新しい健康相談が検出されたらリセット
  if (currentState === "COMPLETED" && healthAnalysis.isHealthRelated) {
    console.log("[health-consultation] Resetting completed consultation for new health issue")
    // データベースもリセット
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        healthConsultationState: null,
        healthConsultationData: null,
      },
    })
    currentState = null

    // フロントエンドに状態リセットを通知
    if (global.io) {
      global.io.to(`conversation-${conversationId}`).emit('conversation-state-updated', {
        conversationId,
        healthConsultationState: null,
      })
      console.log(`[WebSocket] Notified frontend of health consultation state reset`)
    }
  }

  // キャンセルメッセージの検出（最優先で処理）
  if (latestWorkerMessage && currentState && currentState !== "COMPLETED") {
    // より厳格なキャンセル判定: メッセージ全体がキャンセルの意図であることを確認
    const cancelKeywords = ['医療相談を中止', '中止します', 'キャンセル', 'やめます', 'Tôi muốn dừng tư vấn y tế', 'Hủy bỏ tư vấn', 'Dừng tư vấn']
    const messageLower = latestWorkerMessage.body.toLowerCase().trim()
    const isCancelled = cancelKeywords.some(keyword => {
      const keywordLower = keyword.toLowerCase()
      // キーワードが単独で、または文の主要部分として存在するか確認
      return messageLower === keywordLower ||
             messageLower.startsWith(keywordLower) ||
             messageLower.endsWith(keywordLower) ||
             messageLower.includes(keywordLower + '。') ||
             messageLower.includes(keywordLower + '、')
    })

    if (isCancelled) {
      console.log("[health-consultation] User requested cancellation")

      // ワーカーのlocaleを取得
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          worker: {
            select: { locale: true },
          },
        },
      })

      const workerLocale = conversation?.worker.locale || "ja"

      // 事前に翻訳されたメッセージ（翻訳APIの呼び出しをスキップして高速化）
      const cancelMessages: Record<string, string> = {
        ja: "承知しました。医療相談を中止します。\n\nまた何かございましたら、いつでもお知らせください。",
        vi: "承知しました。医療相談を中止します。\n\nまた何かございましたら、いつでもお知らせください。\n\n---TRANSLATION---\n\nĐã hiểu. Tôi sẽ dừng tư vấn y tế.\n\nNếu có gì, hãy cho tôi biết bất cứ lúc nào.",
      }

      // ステート更新: COMPLETED（メッセージ送信前に実行）
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
          healthConsultationState: "COMPLETED", // フロントエンド更新用
        },
        skipTranslation: true, // 事前翻訳済みのため翻訳をスキップ
      })

      return true
    }
  }

  // ①初回検出：受診希望の確認
  if (!currentState && healthAnalysis.isHealthRelated) {
    console.log("[health-consultation] Initial detection - sending confirmation message")

    // 質問リストを整形
    const questionsText = healthAnalysis.suggestedQuestions && healthAnalysis.suggestedQuestions.length > 0
      ? `\n\n${healthAnalysis.suggestedQuestions.join('\n')}`
      : ""

    const confirmationMessage = `大丈夫ですか？心配ですね。${questionsText}\n\n病院に行く必要がありそうですか？`

    await sendSystemMessage({
      conversationId,
      body: confirmationMessage,
      metadata: {
        type: "health_consultation_confirmation",
        showYesNoButtons: true,
        healthAnalysis,
      },
    })

    // ステート更新: WAITING_FOR_INTENT
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        healthConsultationState: "WAITING_FOR_INTENT",
        healthConsultationData: healthAnalysis as Prisma.InputJsonValue,
      },
    })

    // フロントエンドに状態変更を通知
    if (global.io) {
      global.io.to(`conversation-${conversationId}`).emit('conversation-state-updated', {
        conversationId,
        healthConsultationState: "WAITING_FOR_INTENT",
      })
    }

    return true
  }

  // ③日時情報の取得（WAITING_FOR_SCHEDULEステート）
  if (currentState === "WAITING_FOR_SCHEDULE" && latestWorkerMessage && conversationHistory) {
    console.log("[health-consultation] Analyzing schedule preference")

    const intentAnalysis = await analyzeConsultationIntent({
      workerMessage: latestWorkerMessage.body,
      conversationHistory,
    })

    console.log("[health-consultation] Schedule analysis result:", intentAnalysis)

    if (intentAnalysis.preferredDate || intentAnalysis.timePreference) {
      // 日時情報が取得できた
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

      // ステート更新: PROVIDING_FACILITIES
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          healthConsultationState: "PROVIDING_FACILITIES",
          healthConsultationData: {
            ...healthAnalysis,
            intentAnalysis,
          } as Prisma.InputJsonValue,
        },
      })

      // 即座に医療機関検索を実行
      console.log("[health-consultation] Immediately executing facility search after schedule update")
      const updatedAnalysis = {
        ...healthAnalysis,
        intentAnalysis,
      }
      return handleHealthConsultationFlow(
        conversationId,
        updatedAnalysis as Awaited<ReturnType<typeof analyzeHealthConsultation>>,
        "PROVIDING_FACILITIES",
        workerAddress,
        latestWorkerMessage,
        conversationHistory,
      )
    } else {
      // 日時情報が不明確
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

  // ②受診希望の判定と日時確認
  if (currentState === "WAITING_FOR_INTENT" && latestWorkerMessage && conversationHistory) {
    console.log("[health-consultation] Analyzing consultation intent")

    const intentAnalysis = await analyzeConsultationIntent({
      workerMessage: latestWorkerMessage.body,
      conversationHistory,
    })

    console.log("[health-consultation] Intent analysis result:", intentAnalysis)

    if (intentAnalysis.wantsConsultation) {
      // 受診希望あり - 日時を確認
      let scheduleMessage = "承知しました。いつ受診したいですか？\n\n"

      if (intentAnalysis.preferredDate || intentAnalysis.timePreference) {
        // すでに希望日時が含まれている場合
        const dateStr = intentAnalysis.preferredDate === "today" ? "本日"
          : intentAnalysis.preferredDate === "tomorrow" ? "明日"
          : intentAnalysis.preferredDate === "this_week" ? "今週中"
          : intentAnalysis.specificDate || ""

        const timeStr = intentAnalysis.timePreference === "morning" ? "午前"
          : intentAnalysis.timePreference === "afternoon" ? "午後"
          : intentAnalysis.timePreference === "evening" ? "夕方"
          : ""

        scheduleMessage = `承知しました。${dateStr}${timeStr}での受診をご希望とのことですね。\n\n近隣の医療機関を検索してお伝えします。少々お待ちください。`

        // ステート更新: PROVIDING_FACILITIES（医療機関検索へ）
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            healthConsultationState: "PROVIDING_FACILITIES",
            healthConsultationData: {
              ...healthAnalysis,
              intentAnalysis,
            } as Prisma.InputJsonValue,
          },
        })
      } else {
        // 日時の希望がまだない場合
        scheduleMessage += "例：\n・今日の午後\n・明日の午前中\n・今週中"

        // ステート更新: WAITING_FOR_SCHEDULE
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            healthConsultationState: "WAITING_FOR_SCHEDULE",
            healthConsultationData: {
              ...healthAnalysis,
              intentAnalysis,
            } as Prisma.InputJsonValue,
          },
        })

        // フロントエンドに状態変更を通知
        if (global.io) {
          global.io.to(`conversation-${conversationId}`).emit('conversation-state-updated', {
            conversationId,
            healthConsultationState: "WAITING_FOR_SCHEDULE",
          })
        }
      }

      await sendSystemMessage({
        conversationId,
        body: scheduleMessage,
        metadata: {
          type: "health_consultation_schedule_request",
          intentAnalysis,
        },
      })

      // PROVIDING_FACILITIESステートに遷移した場合は、即座に医療機関検索を実行
      if (intentAnalysis.preferredDate || intentAnalysis.timePreference) {
        // 再帰呼び出しで医療機関検索処理を実行
        console.log("[health-consultation] Immediately executing facility search after schedule confirmation")
        const updatedConversation = await prisma.conversation.findUnique({
          where: { id: conversationId },
        })
        if (updatedConversation?.healthConsultationState === "PROVIDING_FACILITIES") {
          // データベースから最新のhealthConsultationDataを取得して使用
          const storedData = updatedConversation.healthConsultationData as Record<string, unknown> | null
          const updatedAnalysis = storedData || {
            ...healthAnalysis,
            intentAnalysis,
          }
          return handleHealthConsultationFlow(
            conversationId,
            updatedAnalysis as Awaited<ReturnType<typeof analyzeHealthConsultation>>,
            "PROVIDING_FACILITIES",
            workerAddress,
            latestWorkerMessage,
            conversationHistory,
          )
        }
      }

      return true
    } else {
      // 受診希望なし - フロー終了
      console.log("[health-consultation] No consultation requested - ending flow")

      await sendSystemMessage({
        conversationId,
        body: "承知しました。\n\n無理せず、もし症状が悪化したらいつでもお知らせくださいね。お大事にしてください。\n\n【医療機関の紹介は終了しました】",
        metadata: {
          type: "health_consultation_declined",
        },
      })

      // ステート更新: COMPLETED
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          healthConsultationState: "COMPLETED",
        },
      })

      return true
    }
  }

  // ⑤病院予約・受診時の日本語例文生成（PROVIDING_INSTRUCTIONSステート）
  if (currentState === "PROVIDING_INSTRUCTIONS" && healthAnalysis.isHealthRelated) {
    console.log("[health-consultation] Generating Japanese instructions")

    const symptomDescription = healthAnalysis.symptomType === "内科" ? "お腹が痛い"
      : healthAnalysis.symptomType === "外科" ? "怪我をした"
      : healthAnalysis.symptomType === "整形外科" ? "足が痛い"
      : healthAnalysis.symptomType === "歯科" ? "歯が痛い"
      : healthAnalysis.symptomType === "皮膚科" ? "肌に異常がある"
      : healthAnalysis.symptomType === "耳鼻咽喉科" ? "喉が痛い"
      : healthAnalysis.symptomType === "眼科" ? "目が痛い"
      : "体調が悪い"

    const phoneExampleMessage = `## 📞 病院に予約電話をかける時の日本語例文

「もしもし、予約（よやく）をしたいのですが」
(Moshi moshi, yoyaku wo shitai no desu ga)

「${symptomDescription}ので、診察（しんさつ）を受（う）けたいです」
(${symptomDescription} node, shinsatsu wo uketai desu)

「いつ行（い）けますか？」
(Itsu ikemasu ka?)

「名前（なまえ）は〇〇です」
(Namae wa 〇〇 desu)

「電話番号（でんわばんごう）は〇〇です」
(Denwa bangou wa 〇〇 desu)`

    const visitExampleMessage = `## 🏥 病院で受診する時の日本語例文

受付（うけつけ）で：
「初診（しょしん）です」
(Shoshin desu)
→ 初めて来た時に言います

「保険証（ほけんしょう）を持（も）っています」
(Hokenshou wo motte imasu)
→ 保険証がある場合

症状（しょうじょう）を説明する：
「${symptomDescription}」

「いつから？」と聞かれたら：
「昨日（きのう）からです」(Kinou kara desu)
「今朝（けさ）からです」(Kesa kara desu)
「3日前（みっかまえ）からです」(Mikka mae kara desu)

## 💊 よく使う医療用語

・痛い（いたい）= itai = 痛い
・熱（ねつ）= netsu = 熱
・咳（せき）= seki = 咳
・薬（くすり）= kusuri = 薬
・注射（ちゅうしゃ）= chuusha = 注射

何かわからないことがあれば、いつでもマネージャーに聞いてください。お大事にしてください。`

    // 電話例文を送信
    await sendSystemMessage({
      conversationId,
      body: phoneExampleMessage,
      metadata: {
        type: "health_consultation_phone_instructions",
      },
    })

    // 受診例文を送信
    await sendSystemMessage({
      conversationId,
      body: visitExampleMessage,
      metadata: {
        type: "health_consultation_visit_instructions",
      },
    })

    // ステート更新: COMPLETED
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        healthConsultationState: "COMPLETED",
      },
    })

    console.log("[health-consultation] Flow completed successfully")
    return true
  }

  // ④医療機関検索と情報提供（PROVIDING_FACILITIESステート）
  if (currentState === "PROVIDING_FACILITIES" && healthAnalysis.isHealthRelated) {
    console.log("[health-consultation] Searching for medical facilities")

    if (!workerAddress) {
      // 住所が未登録の場合
      await sendSystemMessage({
        conversationId,
        body: "申し訳ございませんが、住所が登録されていないため、医療機関を検索できません。\n\n設定ページから住所を登録してください。",
        metadata: {
          type: "health_consultation_no_address",
        },
      })

      // ステート更新: COMPLETED
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          healthConsultationState: "COMPLETED",
        },
      })

      return true
    }

    try {
      // 医療機関を検索
      const facilities = await searchMedicalFacilities({
        address: workerAddress,
        symptomType: healthAnalysis.symptomType || "内科",
        urgency: healthAnalysis.urgency || "flexible",
      })

      if (facilities.length > 0) {
        // 医療機関が見つかった場合
        const facilityList = facilities.slice(0, 3).map((f, index) => {
          const lines = [
            `${index + 1}. **${f.name}**`,
            `   📍 ${f.address}`,
          ]
          if (f.phoneNumber) {
            lines.push(`   📞 ${f.phoneNumber}`)
          }
          // openingHoursオブジェクトからopenNowを取得
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

        const message = `近隣の医療機関を${facilities.length}件見つけました。以下をご検討ください：\n\n${facilityList}\n\n次のメッセージで、病院への予約電話や受診時の日本語例文をお伝えします。`

        await sendSystemMessage({
          conversationId,
          body: message,
          metadata: {
            type: "health_consultation_facilities",
            facilities: facilities.slice(0, 3),
          },
        })

        // ステート更新: PROVIDING_INSTRUCTIONS
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            healthConsultationState: "PROVIDING_INSTRUCTIONS",
            healthConsultationData: {
              ...healthAnalysis,
              facilities: facilities.slice(0, 3),
            } as Prisma.InputJsonValue,
          },
        })

        // 即座に日本語例文を提供
        console.log("[health-consultation] Immediately providing Japanese instructions after facilities")
        return handleHealthConsultationFlow(
          conversationId,
          healthAnalysis,
          "PROVIDING_INSTRUCTIONS",
          workerAddress,
          latestWorkerMessage,
          conversationHistory,
        )
      } else {
        // 医療機関が見つからなかった場合
        await sendSystemMessage({
          conversationId,
          body: "申し訳ございませんが、近隣の医療機関が見つかりませんでした。\n\n別の地域や症状で再度検索することもできます。何かお手伝いできることがあれば教えてください。",
          metadata: {
            type: "health_consultation_no_facilities",
          },
        })

        // ステート更新: COMPLETED
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            healthConsultationState: "COMPLETED",
          },
        })

        return true
      }
    } catch (error) {
      console.error("[health-consultation] Medical facility search failed:", error)

      await sendSystemMessage({
        conversationId,
        body: "申し訳ございませんが、医療機関の検索中にエラーが発生しました。\n\nしばらく時間をおいて再度お試しいただくか、マネージャーにご相談ください。",
        metadata: {
          type: "health_consultation_search_error",
          error: error instanceof Error ? error.message : String(error),
        },
      })

      return true
    }
  }

  return false
}

/**
 * システムメッセージを会話に送信（二言語対応）
 * 日本語メッセージとワーカーのlocaleへの翻訳を両方表示
 */
async function sendSystemMessage(params: {
  conversationId: string
  body: string
  language?: string
  metadata?: Record<string, unknown>
  skipTranslation?: boolean // 翻訳をスキップする場合（既に翻訳済みの場合など）
}) {
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
      console.error(`[system-message] No manager found for conversation ${params.conversationId} in group ${conversation.group.id}`)
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

        // 両言語を表示（日本語 / Worker's language）
        // 区切りマーカーとして特別な文字列を使用
        finalBody = `${params.body}\n\n---TRANSLATION---\n\n${translationResult.translation}`
        console.log(`[system-message] Translation completed`)
      } catch (error) {
        console.error("[system-message] Translation failed, using original message:", error instanceof Error ? error.message : String(error))
        // 翻訳失敗時は元のメッセージのみ使用
      }
    }

    const message = await prisma.message.create({
      data: {
        conversationId: params.conversationId,
        senderId: systemSenderId,
        body: finalBody,
        language: sourceLanguage,
        type: MessageType.SYSTEM,
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
        console.log(`[WebSocket] Broadcasting system message ${message.id} with metadata:`, messageWithDetails.metadata)
        global.io.to(`conversation-${params.conversationId}`).emit('new-message', {
          conversationId: params.conversationId,
          message: messageWithDetails,
        })
        console.log(`[WebSocket] Broadcasted system message ${message.id}`)
      }
    }

    return message
  } catch (error) {
    console.error("[system-message] Failed to send system message:", error instanceof Error ? error.message : String(error))
    return null
  }
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
          take: 3, // 直近3件（健康相談の判断に使用）
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

    // フェーズ1: 翻訳のみを実行してすぐにDB更新（AI提案とは独立して処理）
    console.log(`[background] Phase 1: Immediate translation for message ${messageId}`)
    console.log(`[background] Translation params - content: "${content}", language: ${language}, targetLanguage: ${targetLanguage}`)
    const translationStartTime = Date.now()

    // 翻訳のみを先に実行（同じ言語の場合はスキップ）
    const translation = content && language !== targetLanguage
      ? await translateMessage({
          content,
          sourceLanguage: language,
          targetLanguage,
        })
      : undefined

    const translationDuration = Date.now() - translationStartTime
    console.log(`[background] Phase 1 completed: Translation in ${translationDuration}ms`)
    console.log(`[background] translation exists: ${!!translation}`)

    // 翻訳結果を即座にDB更新（ユーザーにすぐ表示される）
    if (translation) {
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
      if (global.io) {
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
          console.log(`[WebSocket] Broadcasted translation update for message ${messageId}`)
        }
      }
    }

    // フェーズ2: 健康相談の分析（翻訳の次に優先実行）
    console.log(`[background] Phase 2: Health consultation analysis for message ${messageId}`)
    console.log(`[background] Worker info - Address: ${conversation.worker.address || "未登録"}, Sender role: ${senderRole}`)

    let healthAnalysis: Awaited<ReturnType<typeof analyzeHealthConsultation>> | null = null
    let healthConsultationInProgress = false

    try {
      healthAnalysis = await analyzeHealthConsultation({
        conversationHistory: sortedMessages.map((msg) => ({
          body: msg.body,
          senderRole: msg.sender.role,
          createdAt: msg.createdAt,
        })),
        workerInfo: {
          address: conversation.worker.address,
        },
      })

      console.log("[background] Health consultation analysis completed:", healthAnalysis)
    } catch (error) {
      console.error("[background] Health consultation analysis failed:", error instanceof Error ? error.message : String(error))
      // エラーが発生してもメッセージ処理は続行
      healthAnalysis = { isHealthRelated: false }
    }

    // 健康相談の対話フローを処理（ワーカーからのメッセージの場合のみ）
    if (healthAnalysis && healthAnalysis.isHealthRelated && senderRole === UserRole.MEMBER) {
      try {
        // 最新のワーカーメッセージを取得（senderRoleがMEMBERの最新メッセージ）
        const latestWorkerMsg = sortedMessages
          .filter(msg => msg.sender.role === UserRole.MEMBER)
          .slice(-1)[0]

        const flowHandled = await handleHealthConsultationFlow(
          conversationId,
          healthAnalysis,
          conversation.healthConsultationState,
          conversation.worker.address,
          latestWorkerMsg ? {
            body: latestWorkerMsg.body,
            senderRole: latestWorkerMsg.sender.role,
          } : undefined,
          sortedMessages.map(msg => ({
            body: msg.body,
            senderRole: msg.sender.role,
          })),
        )

        if (flowHandled) {
          console.log("[background] Health consultation flow initiated")
        }
      } catch (error) {
        console.error("[background] Health consultation flow failed:", error instanceof Error ? error.message : String(error))
      }
    }

    // 健康相談が検出された場合、フラグを立てる
    if (healthAnalysis && healthAnalysis.isHealthRelated) {
      healthConsultationInProgress = true
      console.log("[background] Health consultation detected - will skip AI suggestions")
    }

    // フェーズ3: AI提案生成（健康相談中はスキップ）
    console.log(`[background] Phase 3: AI suggestion generation for message ${messageId}`)
    const suggestionStartTime = Date.now()

    let suggestions: SuggestedReply[] = []
    if (!healthConsultationInProgress) {
      try {
        suggestions = await generateSuggestedReplies({
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

        const suggestionDuration = Date.now() - suggestionStartTime
        console.log(`[background] Phase 3 completed: AI suggestions in ${suggestionDuration}ms`)
      } catch (error) {
        console.error("[background] AI suggestion generation failed:", error instanceof Error ? error.message : String(error))
        // エラーが発生してもメッセージ処理は続行
      }
    } else {
      console.log("[background] Phase 3 skipped: Health consultation in progress")
    }

    // フェーズ4: 提案と健康分析の結果を最終更新
    console.log(`[background] Phase 4: Final update with suggestions and health analysis`)
    const extraData: Record<string, unknown> = {
      provider: translation?.provider,
      model: translation?.model,
      healthConsultationInProgress,
    }

    if (healthAnalysis && healthAnalysis.isHealthRelated) {
      extraData.healthAnalysis = healthAnalysis
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

    const duration = Date.now() - startTime
    console.log(`[background] LLM enrichment completed for message ${messageId} in ${duration}ms`)
    console.log(`[background] Breakdown - Translation: ${translationDuration}ms, Total: ${duration}ms`)

    // WebSocketでAI提案完了を通知
    if (global.io) {
      const finalMessage = await prisma.message.findUnique({
        where: { id: messageId },
        include: {
          sender: { select: { id: true, name: true, role: true } },
          llmArtifact: true,
        },
      })
      if (finalMessage) {
        global.io.to(`conversation-${conversationId}`).emit('message-updated', {
          conversationId,
          message: finalMessage,
        })
        console.log(`[WebSocket] Broadcasted final update (with suggestions) for message ${messageId}`)
      }
    }
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
