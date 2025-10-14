import "server-only"

import { GoogleGenerativeAI } from "@google/generative-ai"

import { env } from "@/server/env"

import { MODELS } from "./constants"
import type { HealthConsultationAnalysis } from "./types"
import { parseJsonSafely } from "./utils"

const healthConsultationModel = env.GOOGLE_SUGGEST_API_KEY
  ? new GoogleGenerativeAI(env.GOOGLE_SUGGEST_API_KEY).getGenerativeModel({
      model: MODELS.HEALTH_CONSULTATION,
    })
  : null

/**
 * 会話を分析して健康相談かどうかを判定
 */
export async function analyzeHealthConsultation(params: {
  conversationHistory: Array<{
    body: string
    senderRole: string
    createdAt: Date | string
  }>
  workerInfo: {
    address?: string | null
  }
}): Promise<HealthConsultationAnalysis> {
  if (!healthConsultationModel) {
    console.log("[health-consultation] Model not configured")
    return { isHealthRelated: false }
  }

  // 最新5メッセージのみを使用（高速化のため）
  const recentMessages = params.conversationHistory.slice(-5)
  const transcript = recentMessages
    .map((msg) => {
      const role = msg.senderRole === "MEMBER" ? "メンバー" : "マネージャー"
      return `${role}: ${msg.body}`
    })
    .join("\n")

  const prompt =
    `以下の会話を分析して、健康相談（体調不良、怪我、病気など）に関連しているかを判定してください。\n\n` +
    `会話履歴:\n${transcript}\n\n` +
    `メンバーの住所: ${params.workerInfo.address || "未登録"}\n\n` +
    `以下のJSON形式で回答してください:\n` +
    `{\n` +
    `  "isHealthRelated": boolean,\n` +
    `  "symptomType": "内科" | "外科" | "整形外科" | "歯科" | "皮膚科" | "耳鼻咽喉科" | "眼科" | null,\n` +
    `  "urgency": "immediate" | "today" | "this_week" | "flexible" | null,\n` +
    `  "needsMedicalFacility": boolean,\n` +
    `  "hasAddress": boolean,\n` +
    `  "injuryContext": string | null,\n` +
    `  "suggestedQuestions": string[]\n` +
    `}\n\n` +
    `判定基準:\n` +
    `- isHealthRelated: 体調不良、怪我、病気の相談があればtrue\n` +
    `- symptomType: 症状から適切な診療科を推測\n` +
    `- urgency: "今すぐ"/"すぐに"なら"immediate", "今日"なら"today", "今週中"なら"this_week", その他は"flexible"\n` +
    `- needsMedicalFacility: メンバーが病院を探している、または病院が必要な状況ならtrue\n` +
    `- hasAddress: メンバーの住所が登録されているかどうか\n` +
    `- injuryContext: 怪我の場合、仕事中か否か等の経緯(労災判定に必要)\n` +
    `- suggestedQuestions: まだ聞いていない重要な情報を、自然な話し言葉で1〜3個質問してください。\n` +
    `  例：「いつ頃から痛いですか？」「どんな痛みですか？」「熱はありますか？」\n` +
    `  注意：箇条書きの番号や記号は不要です。質問文のみを配列に入れてください。`

  try {
    const result = await healthConsultationModel.generateContent(prompt)
    const output = result.response.text().trim()

    const analysis = parseJsonSafely<HealthConsultationAnalysis>(output)
    if (analysis) {
      console.log("[health-consultation] Analysis completed:", analysis)
      return analysis
    }

    return { isHealthRelated: false }
  } catch (error) {
    console.error("[health-consultation] Analysis failed:", error instanceof Error ? error.message : String(error))
    return { isHealthRelated: false }
  }
}

/**
 * ワーカーの返信が受診希望かどうかを判定
 */
export async function analyzeConsultationIntent(params: {
  workerMessage: string
  conversationHistory: Array<{
    body: string
    senderRole: string
  }>
}): Promise<{
  wantsConsultation: boolean
  preferredDate?: string
  specificDate?: string
  timePreference?: string
}> {
  if (!healthConsultationModel) {
    console.log("[health-consultation] Model not configured")
    return { wantsConsultation: false }
  }

  const transcript = params.conversationHistory.slice(-3)
    .map((msg) => {
      const role = msg.senderRole === "MEMBER" ? "メンバー" : "システム"
      return `${role}: ${msg.body}`
    })
    .join("\n")

  const prompt =
    `以下の会話履歴と最新のメンバーの返信を見て、メンバーが医療機関への受診を希望しているかを判定してください。\n\n` +
    `会話履歴:\n${transcript}\n\n` +
    `最新のメンバーの返信: ${params.workerMessage}\n\n` +
    `以下のJSON形式で回答してください:\n` +
    `{\n` +
    `  "wantsConsultation": boolean,\n` +
    `  "preferredDate": "today" | "tomorrow" | "this_week" | "specific_date" | null,\n` +
    `  "specificDate": "YYYY-MM-DD" | null,\n` +
    `  "timePreference": "morning" | "afternoon" | "evening" | null\n` +
    `}\n\n` +
    `判定基準:\n` +
    `- wantsConsultation: 以下の場合true\n` +
    `  ・「はい」「お願いします」「受診したい」「病院に行きたい」「行きたい」「行きます」などの明確な肯定\n` +
    `  ・「大丈夫です」という返答も、文脈上（体調不良で病院受診を提案されている場合）は肯定の意図と判断\n` +
    `- wantsConsultation: 以下の場合false\n` +
    `  ・「いいえ」「要らない」「必要ない」「平気です」「今はいい」などの明確な否定\n` +
    `- preferredDate: 「今日」「明日」「今週中」などの希望があれば該当する値を、具体的な日付があれば"specific_date"を\n` +
    `- specificDate: "1月15日"のような具体的な日付があればYYYY-MM-DD形式で\n` +
    `- timePreference: 「午前」「午後」「夕方」などの時間帯の希望があれば該当する値を`

  try {
    const result = await healthConsultationModel.generateContent(prompt)
    const output = result.response.text().trim()

    const intent = parseJsonSafely<{
      wantsConsultation: boolean
      preferredDate?: string
      specificDate?: string
      timePreference?: string
    }>(output)

    if (intent) {
      console.log("[health-consultation] Intent analysis:", intent)
      return intent
    }

    return { wantsConsultation: false }
  } catch (error) {
    console.error("[health-consultation] Intent analysis failed:", error instanceof Error ? error.message : String(error))
    return { wantsConsultation: false }
  }
}
