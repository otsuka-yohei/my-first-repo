import "server-only"

import { GoogleGenerativeAI } from "@google/generative-ai"

import { env } from "@/server/env"

import { MODELS } from "./constants"
import type { ImageAnalysisRequest, ImageAnalysisResult, SuggestedReply } from "./types"
import { parseJsonSafely } from "./utils"

const imageAnalysisModel = env.GOOGLE_SUGGEST_API_KEY
  ? new GoogleGenerativeAI(env.GOOGLE_SUGGEST_API_KEY).getGenerativeModel({
      model: MODELS.IMAGE_ANALYSIS,
    })
  : null

const suggestModel = env.GOOGLE_SUGGEST_API_KEY
  ? new GoogleGenerativeAI(env.GOOGLE_SUGGEST_API_KEY).getGenerativeModel({ model: MODELS.SUGGEST })
  : null

/**
 * 画像を解析してテキスト説明を生成
 */
export async function analyzeImage(
  request: ImageAnalysisRequest,
): Promise<ImageAnalysisResult | null> {
  if (!imageAnalysisModel) {
    console.log("[image-analysis] Model not configured")
    return null
  }

  try {
    console.log(`[image-analysis] Analyzing image: ${request.imageUrl}`)

    // 相対パスの場合、完全なURLに変換
    let fullImageUrl = request.imageUrl
    if (request.imageUrl.startsWith('/')) {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'
      fullImageUrl = `${baseUrl}${request.imageUrl}`
      console.log(`[image-analysis] Converting relative path to full URL: ${fullImageUrl}`)
    }

    // 画像をダウンロード
    const response = await fetch(fullImageUrl)
    if (!response.ok) {
      console.error(`[image-analysis] Failed to fetch image: ${response.status} ${response.statusText}`)
      return null
    }

    const imageBuffer = await response.arrayBuffer()
    const mimeType = response.headers.get("content-type") || "image/jpeg"
    const base64Image = Buffer.from(imageBuffer).toString("base64")

    console.log(`[image-analysis] Image downloaded: ${mimeType}, size: ${imageBuffer.byteLength} bytes`)

    // プロンプトを構築
    const userMessageContext = request.userMessage
      ? `ユーザーのメッセージ: "${request.userMessage}"\n\n`
      : ""

    const prompt =
      `あなたは外国人労働者をサポートする経験豊富なマネージャーです。\n\n` +
      `${userMessageContext}` +
      `添付された画像を分析して、以下の情報を日本語で提供してください：\n\n` +
      `1. **画像の内容**: 何が写っているか、詳しく説明してください\n` +
      `2. **書類の種類**: もし公的書類や重要な書類であれば、その種類を特定してください（例: 年金手帳、保険証、通知書、請求書など）\n` +
      `3. **緊急度**: この内容について、対応の緊急度を判断してください（high/medium/low）\n` +
      `4. **推奨される対応**: 受け取った本人（外国人労働者）がどのような対応をすべきか、具体的に説明してください\n` +
      `5. **抽出されたテキスト**: 画像に含まれる重要なテキスト（日付、金額、宛名など）があれば抽出してください\n\n` +
      `以下のJSON形式で回答してください：\n` +
      `{\n` +
      `  "description": "画像の内容説明",\n` +
      `  "documentType": "書類の種類（該当する場合）",\n` +
      `  "urgency": "high" | "medium" | "low",\n` +
      `  "suggestedActions": ["対応1", "対応2", "対応3"],\n` +
      `  "extractedText": "抽出されたテキスト"\n` +
      `}`

    const result = await imageAnalysisModel.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Image,
        },
      },
    ])

    const text = result.response.text().trim()
    console.log("[image-analysis] Raw output:", text.substring(0, 500))

    const analysis = parseJsonSafely<ImageAnalysisResult>(text)
    if (analysis) {
      console.log("[image-analysis] Completed:", analysis)
    }

    return analysis
  } catch (error) {
    console.error("[image-analysis] Failed:", error instanceof Error ? error.message : String(error))
    if (error instanceof Error && 'cause' in error) {
      console.error("[image-analysis] Error cause:", error.cause)
    }
    return null
  }
}

/**
 * 画像解析結果をもとにAI返信を生成
 */
export async function generateImageBasedReplies(params: {
  imageAnalysis: ImageAnalysisResult
  userMessage?: string
  workerInfo: {
    name?: string | null
    locale?: string | null
  }
  managerLocale?: string
}): Promise<SuggestedReply[]> {
  if (!suggestModel) {
    console.log("[image-analysis] Suggest model not configured")
    return []
  }

  const workerName = params.workerInfo.name || "メンバー"
  const managerLocale = params.managerLocale || "ja"

  // 緊急度に応じたトーン
  const urgencyContext =
    params.imageAnalysis.urgency === "high"
      ? "緊急性が高い内容です。迅速な対応が必要です。"
      : params.imageAnalysis.urgency === "medium"
      ? "対応が必要な内容です。"
      : "参考情報として確認してください。"

  const userMessageContext = params.userMessage
    ? `${workerName}さんのメッセージ: "${params.userMessage}"\n\n`
    : ""

  const prompt =
    `あなたは外国人労働者をサポートする経験豊富なマネージャーです。\n\n` +
    `${workerName}さんから画像が送られてきました。\n\n` +
    `${userMessageContext}` +
    `【画像の分析結果】\n` +
    `- 内容: ${params.imageAnalysis.description}\n` +
    `- 書類の種類: ${params.imageAnalysis.documentType || "不明"}\n` +
    `- 緊急度: ${params.imageAnalysis.urgency}\n` +
    `- ${urgencyContext}\n` +
    `- 推奨される対応:\n${params.imageAnalysis.suggestedActions?.map((action, i) => `  ${i + 1}. ${action}`).join("\n") || "  なし"}\n\n` +
    `この画像に対する返信として、${workerName}さんに送る適切なメッセージを${managerLocale}で3つ提案してください。\n\n` +
    `IMPORTANT: 以下の形式で正確に3つのメッセージを返してください（1行に1つ）:\n` +
    `confirmation: [内容を確認した旨のメッセージ]\n` +
    `guidance: [具体的な対応手順を案内するメッセージ]\n` +
    `support: [サポートを申し出るメッセージ]\n\n` +
    `番号付けやマークダウン形式は使用しないでください。`

  try {
    const result = await suggestModel.generateContent(prompt)
    const output = result.response.text().trim()

    console.log("[image-analysis] Raw suggestion output:", output)

    const suggestions = output
      .split("\n")
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
      .map((line) => {
        const colonIndex = line.indexOf(":")
        if (colonIndex === -1) {
          return {
            content: line,
            tone: "solution" as const,
            language: managerLocale,
          }
        }

        const toneLabel = line.substring(0, colonIndex).trim().toLowerCase()
        const content = line.substring(colonIndex + 1).trim()

        const tone: SuggestedReply["tone"] =
          toneLabel === "question" || toneLabel === "empathy" || toneLabel === "solution"
            ? toneLabel
            : "solution"

        return {
          content: content || line,
          tone,
          language: managerLocale,
        }
      })
      .filter((s) => s.content.length > 0)

    console.log("[image-analysis] Parsed suggestions:", JSON.stringify(suggestions, null, 2))

    return suggestions
  } catch (error) {
    console.error("[image-analysis] Failed to generate suggestions:", error instanceof Error ? error.message : String(error))
    return []
  }
}
