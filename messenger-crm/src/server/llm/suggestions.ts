import "server-only"

import { GoogleGenerativeAI } from "@google/generative-ai"

import { env } from "@/server/env"

import { MODELS } from "./constants"
import type { SuggestionRequest, EnhancedSuggestionRequest, SuggestedReply } from "./types"
import { getLocaleLabel, calculateAge, calculateYearsOfService } from "./utils"
import { translateMessage } from "./translation"

const suggestModel = env.GOOGLE_SUGGEST_API_KEY
  ? new GoogleGenerativeAI(env.GOOGLE_SUGGEST_API_KEY).getGenerativeModel({ model: MODELS.SUGGEST })
  : null

/**
 * 提案のトーン種別を判定
 */
function parseTone(toneLabel: string): SuggestedReply["tone"] {
  const normalized = toneLabel.trim().toLowerCase()
  if (normalized === "question" || normalized === "empathy" || normalized === "solution") {
    return normalized
  }
  return "solution"
}

/**
 * LLM出力から提案リストをパース
 */
function parseSuggestions(output: string, language: string): SuggestedReply[] {
  return output
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const colonIndex = line.indexOf(":")
      if (colonIndex === -1) {
        return {
          content: line,
          tone: "solution" as const,
          language,
        }
      }

      const toneLabel = line.substring(0, colonIndex).trim()
      const content = line.substring(colonIndex + 1).trim()

      return {
        content: content || line,
        tone: parseTone(toneLabel),
        language,
      }
    })
    .filter((s) => s.content.length > 0)
}

/**
 * 基本的な提案生成（後方互換性のため）
 */
function generateBasicSuggestions(request: SuggestionRequest): { prompt: string; operationName: string } {
  const prompt =
    `You are an empathetic support ${request.persona}. Based on the following customer transcript, ` +
    `suggest exactly 3 concise replies in ${request.language}.\n\n` +
    `IMPORTANT: Return ONLY the replies in this exact format (one per line):\n` +
    `question: [your question reply here]\n` +
    `empathy: [your empathetic reply here]\n` +
    `solution: [your solution-oriented reply here]\n\n` +
    `Do NOT include any other text, numbering, or markdown formatting.\n\n` +
    `Transcript:\n${request.transcript}`

  return { prompt, operationName: `suggestions-${request.language}` }
}

/**
 * コンテキスト情報を構築
 */
function buildContextDescription(params: {
  workerName: string
  workerLocale: string
  recentMessages: Array<{ body: string; senderRole: string }>
  daysSince: number
  isInitialMessage: boolean
}): { description: string; tones: string[] } {
  const { workerName, workerLocale, recentMessages, daysSince, isInitialMessage } = params

  // 初回メッセージ
  if (isInitialMessage) {
    return {
      description: `${workerName}さん（${workerLocale}話者）への初回メッセージを作成してください。「このチャットで、業務上の相談やシフト、何か困ったことがあればなんでもメッセージを送ってください。」という趣旨の温かく親しみやすいメッセージを3パターン提案してください。`,
      tones: ["welcome", "welcome", "welcome"],
    }
  }

  // 健康相談の検出
  const recentWorkerMessages = recentMessages.filter(msg => msg.senderRole === "MEMBER").slice(-3)
  const lastWorkerMessage = recentWorkerMessages[recentWorkerMessages.length - 1]
  const isHealthRelated = lastWorkerMessage?.body && (
    /体調|痛|怪我|ケガ|病気|熱|風邪|頭痛|腹痛|咳|吐き気|めまい|病院|医者|診察/.test(lastWorkerMessage.body)
  )

  if (isHealthRelated) {
    return {
      description: `${workerName}さん（${workerLocale}話者）から健康相談がありました。症状の詳細、いつ病院に行きたいか、怪我の場合は労災の可能性（仕事中か等）を確認し、必要に応じて病院探しをサポートしてください。`,
      tones: ["empathy", "question", "solution"],
    }
  }

  // 7日以上経過
  if (daysSince > 7) {
    return {
      description: `前回の会話から1週間以上経過しています。${workerName}さん（${workerLocale}話者）の現在の状況や悩みを確認する、温かみのあるメッセージを提案してください。`,
      tones: ["check-in", "check-in", "check-in"],
    }
  }

  // 3日以上経過
  if (daysSince > 3) {
    return {
      description: `前回の会話から3日以上経過しています。${workerName}さん（${workerLocale}話者）について、前回の話題について優しくフォローアップするメッセージを提案してください。`,
      tones: ["gentle-follow-up", "gentle-follow-up", "continuation"],
    }
  }

  // マネージャー連投
  const lastMessages = recentMessages.slice(-3)
  const consecutiveManagerMessages = lastMessages.filter(msg => msg.senderRole !== "MEMBER").length
  if (consecutiveManagerMessages >= 2) {
    return {
      description: `マネージャーが連続してメッセージを送信しています。${workerName}さん（${workerLocale}話者）が安心して返信できるような、継続や励ましのメッセージを提案してください。`,
      tones: ["continuation", "encouragement", "empathy"],
    }
  }

  // 通常の返信
  return {
    description: `${workerName}さん（${workerLocale}話者）からのメッセージに対して、適切な返信を提案してください。`,
    tones: ["question", "empathy", "solution"],
  }
}

/**
 * 拡張された提案生成（会話履歴とユーザー情報を参照）
 */
function generateEnhancedSuggestions(request: EnhancedSuggestionRequest): { prompt: string; operationName: string } {
  const workerName = request.workerInfo.name || "相談者"
  const workerLocale = request.workerInfo.locale ? getLocaleLabel(request.workerInfo.locale) : "不明"

  // ワーカーの詳細情報を構築
  const workerDetails: string[] = []
  if (request.workerInfo.countryOfOrigin) {
    workerDetails.push(`出身国: ${request.workerInfo.countryOfOrigin}`)
  }
  if (request.workerInfo.dateOfBirth) {
    const age = calculateAge(request.workerInfo.dateOfBirth)
    workerDetails.push(`年齢: ${age}歳`)
  }
  if (request.workerInfo.gender) {
    workerDetails.push(`性別: ${request.workerInfo.gender}`)
  }
  if (request.workerInfo.jobDescription) {
    workerDetails.push(`業務内容: ${request.workerInfo.jobDescription}`)
  }
  if (request.workerInfo.hireDate) {
    const yearsOfService = calculateYearsOfService(request.workerInfo.hireDate)
    workerDetails.push(`勤続年数: ${yearsOfService}`)
  }
  if (request.workerInfo.address) {
    workerDetails.push(`住所: ${request.workerInfo.address}`)
  }
  if (request.workerInfo.notes) {
    workerDetails.push(`備考: ${request.workerInfo.notes}`)
  }

  // グループ情報を構築
  const groupDetails: string[] = []
  if (request.groupInfo?.name) {
    groupDetails.push(`所属グループ: ${request.groupInfo.name}`)
  }
  if (request.groupInfo?.address) {
    groupDetails.push(`グループ住所: ${request.groupInfo.address}`)
  }
  if (request.groupInfo?.phoneNumber) {
    groupDetails.push(`グループ電話番号: ${request.groupInfo.phoneNumber}`)
  }

  // 会話履歴を要約（直近10件）
  const recentMessages = request.conversationHistory.slice(-10)
  const transcript = recentMessages
    .map((msg) => {
      const time = new Date(msg.createdAt).toLocaleString("ja-JP")
      const role = msg.senderRole === "MEMBER" ? "メンバー" : "マネージャー"
      return `[${time}] ${role}: ${msg.body}`
    })
    .join("\n")

  const daysSince = request.daysSinceLastWorkerMessage ?? 0
  const isInitialMessage = recentMessages.length === 0

  const { description: contextDescription, tones } = buildContextDescription({
    workerName,
    workerLocale,
    recentMessages,
    daysSince,
    isInitialMessage,
  })

  // メンバー情報セクション
  const workerInfoSection = workerDetails.length > 0
    ? `\n\n### メンバー情報:\n${workerDetails.join("\n")}`
    : ""

  // グループ情報セクション
  const groupInfoSection = groupDetails.length > 0
    ? `\n\n### グループ情報:\n${groupDetails.join("\n")}`
    : ""

  const prompt =
    `あなたは外国人労働者をサポートする経験豊富なマネージャーです。以下の情報に基づいて、` +
    `${workerName}さん（${workerLocale}話者）に送る次のメッセージを${request.language}で3つ提案してください。\n\n` +
    `${contextDescription}${workerInfoSection}${groupInfoSection}\n\n` +
    `IMPORTANT: 以下の形式で正確に3つのメッセージを返してください（1行に1つ）:\n` +
    `${tones[0]}: [メッセージ内容1]\n` +
    `${tones[1]}: [メッセージ内容2]\n` +
    `${tones[2]}: [メッセージ内容3]\n\n` +
    `番号付けやマークダウン形式は使用しないでください。\n` +
    `上記のメンバー情報とグループ情報を考慮して、個別化された適切なメッセージを提案してください。\n\n` +
    `会話履歴:\n${transcript}\n\n` +
    `前回のメンバーからのメッセージからの経過日数: ${Math.round(daysSince)} 日`

  return { prompt, operationName: `enhanced-suggestions-${request.language}` }
}

/**
 * 提案された返信を生成
 */
export async function generateSuggestedReplies(
  request: SuggestionRequest | EnhancedSuggestionRequest,
): Promise<SuggestedReply[]> {
  if (!suggestModel) {
    console.log("[suggestions] GOOGLE_SUGGEST_API_KEY not configured, returning mock suggestions")
    return [
      {
        content: "ご質問ありがとうございます。詳しく教えていただけますか？",
        tone: "question",
        language: request.language,
      },
      {
        content: "お困りの状況、理解いたしました。",
        tone: "empathy",
        language: request.language,
      },
      {
        content: "こちらの方法で解決できるかと思います。",
        tone: "solution",
        language: request.language,
      },
    ]
  }

  // 後方互換性のため、古い形式もサポート
  const isEnhanced = 'conversationHistory' in request
  const { prompt, operationName } = isEnhanced
    ? generateEnhancedSuggestions(request)
    : generateBasicSuggestions(request)

  try {
    const result = await suggestModel.generateContent(prompt)
    const output = result.response.text().trim()

    console.log("[suggestions] Raw output:", output)

    const suggestions = parseSuggestions(output, request.language)

    console.log("[suggestions] Parsed suggestions:", JSON.stringify(suggestions, null, 2))

    if (suggestions.length === 0) {
      console.error("[suggestions] Failed to parse any suggestions from output")
      return [
        {
          content: "ご質問ありがとうございます。",
          tone: "question",
          language: request.language,
        },
      ]
    }

    // 翻訳が必要な場合
    if (request.targetTranslationLanguage && request.targetTranslationLanguage !== request.language) {
      console.log(`[suggestions] Translating from ${request.language} to ${request.targetTranslationLanguage}`)

      try {
        const translatedSuggestions = await Promise.all(
          suggestions.map(async (suggestion, index) => {
            try {
              const translationResult = await translateMessage({
                content: suggestion.content,
                sourceLanguage: request.language,
                targetLanguage: request.targetTranslationLanguage!,
              })

              console.log(`[suggestions] Suggestion ${index + 1}/${suggestions.length} translated successfully`)

              return {
                ...suggestion,
                translation: translationResult.translation,
                translationLang: request.targetTranslationLanguage,
              }
            } catch (error) {
              console.error(`[suggestions] Failed to translate suggestion ${index + 1}:`, error instanceof Error ? error.message : String(error))
              return suggestion
            }
          })
        )

        const successCount = translatedSuggestions.filter(s => 'translation' in s && s.translation).length
        console.log(`[suggestions] Translation complete: ${successCount}/${suggestions.length} suggestions translated`)

        return translatedSuggestions
      } catch (error) {
        console.error("[suggestions] Critical error during translation:", error instanceof Error ? error.message : String(error))
        console.log("[suggestions] Falling back to suggestions without translations")
        return suggestions
      }
    }

    return suggestions
  } catch (error) {
    console.error("[suggestions] Failed to generate:", error instanceof Error ? error.message : String(error))
    return []
  }
}
