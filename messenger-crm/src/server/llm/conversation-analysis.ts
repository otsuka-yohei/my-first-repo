import "server-only"

import { GoogleGenerativeAI } from "@google/generative-ai"

import { env } from "@/server/env"

import { MODELS } from "./constants"
import type { ConversationTagsResult, ConversationMessage, ConversationSegment, SegmentationRequest } from "./types"
import { parseJsonSafely, parseJsonArraySafely } from "./utils"

const taggingModel = env.GOOGLE_TAGGING_API_KEY
  ? new GoogleGenerativeAI(env.GOOGLE_TAGGING_API_KEY).getGenerativeModel({ model: MODELS.TAGGING })
  : null

const segmentModel = env.GOOGLE_SEGMENT_API_KEY
  ? new GoogleGenerativeAI(env.GOOGLE_SEGMENT_API_KEY).getGenerativeModel({ model: MODELS.SEGMENT })
  : null

/**
 * 会話のカテゴリとタグを生成
 */
export async function generateConversationTags(
  messages: ConversationMessage[],
): Promise<ConversationTagsResult> {
  if (!messages.length) {
    return {
      category: "未分類",
      tags: [],
    }
  }

  const transcript = messages
    .map((msg) => {
      const time = new Date(msg.createdAt).toLocaleString("ja-JP")
      const role = msg.senderRole === "MEMBER" ? "相談者" : "担当者"
      return `[${time}] ${role}: ${msg.body}`
    })
    .join("\n\n")

  const prompt =
    `以下は相談チャットの会話履歴です。この会話を分析して、相談のカテゴリと関連タグを生成してください。\n\n` +
    `### 指示:\n` +
    `1. 相談の主要なカテゴリを1つ選んでください（例: 給与相談、労働時間、休暇、健康保険、人間関係、その他）\n` +
    `2. 関連する詳細タグを2〜5個生成してください\n` +
    `3. 相談内容を1行で要約してください\n\n` +
    `### 出力形式（JSON）:\n` +
    `{\n` +
    `  "category": "カテゴリ名",\n` +
    `  "tags": ["タグ1", "タグ2", "タグ3"],\n` +
    `  "summary": "相談内容の要約"\n` +
    `}\n\n` +
    `### 会話履歴:\n${transcript}`

  if (!taggingModel) {
    console.log("[conversation-tagging] API not configured")
    return {
      category: "未分類",
      tags: [],
      summary: "API設定がありません",
    }
  }

  try {
    const result = await taggingModel.generateContent(prompt)
    const output = result.response.text().trim()

    console.log("[conversation-tagging] Raw output:", output)

    const parsed = parseJsonSafely<ConversationTagsResult>(output)
    if (parsed) {
      console.log("[conversation-tagging] Parsed tags successfully:", parsed)
      return {
        category: parsed.category || "未分類",
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        summary: parsed.summary || undefined,
      }
    }

    return {
      category: "その他",
      tags: [],
      summary: "タグの解析に失敗しました",
    }
  } catch (error) {
    console.error("[conversation-tagging] Failed:", error instanceof Error ? error.message : String(error))
    return {
      category: "その他",
      tags: [],
      summary: "分析に失敗しました",
    }
  }
}

/**
 * 会話を話題ごとに分割
 */
export async function segmentConversation(
  request: SegmentationRequest,
): Promise<ConversationSegment[]> {
  if (request.messages.length === 0) {
    return []
  }

  const transcript = request.messages
    .map((msg, index) => {
      const time = new Date(msg.createdAt).toLocaleString("ja-JP")
      const role = msg.senderRole === "MEMBER" ? "相談者" : "担当者"
      return `[メッセージ ${index}] [${time}] ${role}: ${msg.body}`
    })
    .join("\n\n")

  const prompt =
    `以下は相談チャットの会話履歴です。この会話を話題ごとに分割してください。\n\n` +
    `### 指示:\n` +
    `1. 会話を意味のある話題（トピック）ごとに分割してください\n` +
    `2. 各セグメントにタイトルと要約をつけてください\n` +
    `3. 各セグメントに含まれるメッセージのインデックス番号（開始と終了）を指定してください\n` +
    `4. セグメントは時系列順に並べてください\n\n` +
    `### 出力形式（JSON配列）:\n` +
    `[\n` +
    `  {\n` +
    `    "title": "セグメントのタイトル",\n` +
    `    "summary": "セグメントの要約",\n` +
    `    "startIndex": 0,\n` +
    `    "endIndex": 3\n` +
    `  }\n` +
    `]\n\n` +
    `### 会話履歴:\n${transcript}`

  if (!segmentModel) {
    console.log("[conversation-segmentation] API not configured")
    return [{
      title: "会話全体",
      summary: "API設定がありません",
      messageIds: request.messages.map((m) => m.id),
      startedAt: new Date(request.messages[0].createdAt),
      endedAt: new Date(request.messages[request.messages.length - 1].createdAt),
    }]
  }

  try {
    const result = await segmentModel.generateContent(prompt)
    const output = result.response.text().trim()

    console.log("[conversation-segmentation] Raw output:", output.substring(0, 500))

    const parsed = parseJsonArraySafely<{
      title: string
      summary: string
      startIndex: number
      endIndex: number
    }>(output)

    if (!parsed) {
      throw new Error("Failed to parse segments")
    }

    console.log(`[conversation-segmentation] Parsed ${parsed.length} segments successfully`)

    return parsed
      .map((segment) => {
        const startIdx = Math.max(0, segment.startIndex)
        const endIdx = Math.min(request.messages.length - 1, segment.endIndex)

        if (startIdx > endIdx) {
          console.warn(`[conversation-segmentation] Invalid segment indices: ${startIdx} > ${endIdx}`)
          return null
        }

        const segmentMessages = request.messages.slice(startIdx, endIdx + 1)
        return {
          title: segment.title || "無題",
          summary: segment.summary || "",
          messageIds: segmentMessages.map((m) => m.id),
          startedAt: new Date(segmentMessages[0].createdAt),
          endedAt: new Date(segmentMessages[segmentMessages.length - 1].createdAt),
        }
      })
      .filter((s): s is ConversationSegment => s !== null)
  } catch (error) {
    console.error("[conversation-segmentation] Failed:", error instanceof Error ? error.message : String(error))
    return [{
      title: "会話全体",
      summary: "セグメントの解析に失敗しました",
      messageIds: request.messages.map((m) => m.id),
      startedAt: new Date(request.messages[0].createdAt),
      endedAt: new Date(request.messages[request.messages.length - 1].createdAt),
    }]
  }
}
