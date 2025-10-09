import "server-only"

import { GoogleGenerativeAI } from "@google/generative-ai"

import { env } from "@/server/env"

const TRANSLATE_MODEL = "gemini-2.5-flash"
const SUGGEST_MODEL = "gemini-2.5-flash"
const TAGGING_MODEL = "gemini-2.5-flash"
const SEGMENT_MODEL = "gemini-2.5-flash"

// シンプルな翻訳キャッシュ（メモリベース）
// キャッシュサイズを制限して、メモリリークを防ぐ
const CACHE_MAX_SIZE = 500
const translationCache = new Map<string, { translation: string; timestamp: number }>()

function getCacheKey(content: string, sourceLang: string, targetLang: string): string {
  // 内容、元言語、翻訳先言語からキャッシュキーを生成
  return `${sourceLang}:${targetLang}:${content.substring(0, 200)}`
}

function getCachedTranslation(content: string, sourceLang: string, targetLang: string): string | null {
  const key = getCacheKey(content, sourceLang, targetLang)
  const cached = translationCache.get(key)

  if (cached) {
    // 1時間以内のキャッシュのみ有効
    const age = Date.now() - cached.timestamp
    if (age < 60 * 60 * 1000) {
      console.log(`[llm] translate: Cache hit (age: ${Math.round(age / 1000)}s)`)
      return cached.translation
    } else {
      translationCache.delete(key)
    }
  }

  return null
}

function setCachedTranslation(content: string, sourceLang: string, targetLang: string, translation: string): void {
  // キャッシュサイズ制限を超えた場合、古いエントリを削除
  if (translationCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = translationCache.keys().next().value
    if (oldestKey) {
      translationCache.delete(oldestKey)
      console.log(`[llm] translate: Cache eviction (size: ${translationCache.size})`)
    }
  }

  const key = getCacheKey(content, sourceLang, targetLang)
  translationCache.set(key, { translation, timestamp: Date.now() })
}

const translateModel = env.GOOGLE_TRANSLATE_API_KEY
  ? new GoogleGenerativeAI(env.GOOGLE_TRANSLATE_API_KEY).getGenerativeModel({ model: TRANSLATE_MODEL })
  : null

const suggestModel = env.GOOGLE_SUGGEST_API_KEY
  ? new GoogleGenerativeAI(env.GOOGLE_SUGGEST_API_KEY).getGenerativeModel({ model: SUGGEST_MODEL })
  : null

const taggingModel = env.GOOGLE_TAGGING_API_KEY
  ? new GoogleGenerativeAI(env.GOOGLE_TAGGING_API_KEY).getGenerativeModel({ model: TAGGING_MODEL })
  : null

const segmentModel = env.GOOGLE_SEGMENT_API_KEY
  ? new GoogleGenerativeAI(env.GOOGLE_SEGMENT_API_KEY).getGenerativeModel({ model: SEGMENT_MODEL })
  : null

export interface TranslationRequest {
  content: string
  sourceLanguage: string
  targetLanguage: string
}

export interface TranslationResult {
  translation: string
  provider: string
  model: string
  warnings?: string[]
}

export interface SuggestedReply {
  content: string
  tone: "question" | "empathy" | "solution"
  language: string
  translation?: string
  translationLang?: string
}

export interface SuggestionRequest {
  transcript: string
  language: string
  persona: "agent" | "manager"
  targetTranslationLanguage?: string
}

export interface EnrichmentResult {
  translation?: TranslationResult
  suggestions?: SuggestedReply[]
}

async function safeGenerateText(model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]> | null, prompt: string, operationName = "generate") {
  if (!model) {
    console.log(`[llm] ${operationName}: Model not configured, skipping`)
    return null
  }

  const startTime = Date.now()

  try {
    console.log(`[llm] ${operationName}: Starting (prompt length: ${prompt.length} chars)`)

    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()

    const duration = Date.now() - startTime
    const inputTokens = Math.ceil(prompt.length / 4) // 概算
    const outputTokens = Math.ceil(text.length / 4) // 概算

    console.log(`[llm] ${operationName}: Success (${duration}ms, ~${inputTokens + outputTokens} tokens)`)

    return text
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[llm] ${operationName}: Failed after ${duration}ms -`, error instanceof Error ? error.message : String(error))

    if (error instanceof Error && "response" in error) {
      console.error(`[llm] ${operationName}: API response:`, JSON.stringify(error, null, 2))
    }

    return null
  }
}

export async function translateMessage(
  request: TranslationRequest,
): Promise<TranslationResult> {
  // キャッシュをチェック
  const cachedTranslation = getCachedTranslation(request.content, request.sourceLanguage, request.targetLanguage)
  if (cachedTranslation) {
    return {
      translation: cachedTranslation,
      provider: "google-ai-studio",
      model: TRANSLATE_MODEL,
      warnings: ["Translation retrieved from cache"],
    }
  }

  const prompt =
    `You are a professional translator specializing in customer support communications.\n\n` +
    `Translate the following message from ${request.sourceLanguage} to ${request.targetLanguage}.\n\n` +
    `IMPORTANT Guidelines:\n` +
    `- Maintain a polite and professional tone appropriate for customer support\n` +
    `- Preserve the original meaning and intent\n` +
    `- Use natural, conversational language that native speakers would use\n` +
    `- Return ONLY the translated text, without any additional explanation or formatting\n\n` +
    `Message:\n${request.content}`

  const output = await safeGenerateText(translateModel, prompt, `translate-${request.sourceLanguage}-to-${request.targetLanguage}`)

  if (!output) {
    const reason = translateModel ? "Translation request failed" : "GOOGLE_TRANSLATE_API_KEY not set"
    console.log(`[llm] translate: ${reason}; returning original content`)
    return {
      translation: request.content,
      provider: translateModel ? "google-ai-studio" : "mock",
      model: translateModel ? TRANSLATE_MODEL : "offline",
      warnings: [`${reason}; returning original content.`],
    }
  }

  // キャッシュに保存
  setCachedTranslation(request.content, request.sourceLanguage, request.targetLanguage, output)

  console.log(`[llm] Translation successful: ${request.sourceLanguage} -> ${request.targetLanguage}`)
  return {
    translation: output,
    provider: "google-ai-studio",
    model: TRANSLATE_MODEL,
  }
}

export async function generateSuggestedReplies(
  request: SuggestionRequest,
): Promise<SuggestedReply[]> {
  const prompt =
    `You are an empathetic support ${request.persona}. Based on the following customer transcript, ` +
    `suggest exactly 3 concise replies in ${request.language}.\n\n` +
    `IMPORTANT: Return ONLY the replies in this exact format (one per line):\n` +
    `question: [your question reply here]\n` +
    `empathy: [your empathetic reply here]\n` +
    `solution: [your solution-oriented reply here]\n\n` +
    `Do NOT include any other text, numbering, or markdown formatting.\n\n` +
    `Transcript:\n${request.transcript}`

  const output = await safeGenerateText(suggestModel, prompt, `suggestions-${request.language}`)

  if (!output) {
    if (!suggestModel) {
      console.log("[llm] suggestions: GOOGLE_SUGGEST_API_KEY not configured, returning mock suggestions")
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
    console.error("[llm] Failed to generate suggestions: no output from LLM")
    return []
  }

  console.log("[llm] Raw suggestion output:", output)

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
          language: request.language,
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
        language: request.language,
      }
    })
    .filter((s) => s.content.length > 0)

  console.log("[llm] Parsed suggestions:", JSON.stringify(suggestions, null, 2))

  if (suggestions.length === 0) {
    console.error("[llm] Failed to parse any suggestions from output")
    return [
      {
        content: "ご質問ありがとうございます。",
        tone: "question",
        language: request.language,
      },
    ]
  }

  // 翻訳が必要な場合（targetTranslationLanguageが指定され、languageと異なる場合）
  if (request.targetTranslationLanguage && request.targetTranslationLanguage !== request.language) {
    console.log(`[llm] Translating suggestions from ${request.language} to ${request.targetTranslationLanguage}`)

    try {
      const translatedSuggestions = await Promise.all(
        suggestions.map(async (suggestion, index) => {
          try {
            const translationResult = await translateMessage({
              content: suggestion.content,
              sourceLanguage: request.language,
              targetLanguage: request.targetTranslationLanguage!,
            })

            console.log(`[llm] Suggestion ${index + 1}/${suggestions.length} translated successfully`)

            return {
              ...suggestion,
              translation: translationResult.translation,
              translationLang: request.targetTranslationLanguage,
            }
          } catch (error) {
            console.error(`[llm] Failed to translate suggestion ${index + 1}:`, error instanceof Error ? error.message : String(error))
            // 翻訳失敗時は元のsuggestionをそのまま返す（翻訳なし）
            return suggestion
          }
        })
      )

      const successCount = translatedSuggestions.filter(s => 'translation' in s && s.translation).length
      console.log(`[llm] Translation complete: ${successCount}/${suggestions.length} suggestions translated successfully`)

      return translatedSuggestions
    } catch (error) {
      console.error("[llm] Critical error during translation:", error instanceof Error ? error.message : String(error))
      // 全体の翻訳処理が失敗した場合でも、元のsuggestionを返す
      console.log("[llm] Falling back to suggestions without translations")
      return suggestions
    }
  }

  return suggestions
}

export async function enrichMessageWithLLM(params: {
  content: string
  language: string
  targetLanguage: string
  workerLocale?: string
}): Promise<EnrichmentResult> {
  // Workerのlocaleが日本語以外の場合、AI返信に翻訳を追加
  const shouldTranslateSuggestions = params.workerLocale &&
    !params.workerLocale.toLowerCase().startsWith('ja') &&
    params.targetLanguage !== params.workerLocale

  const [translation, suggestions] = await Promise.all([
    translateMessage({
      content: params.content,
      sourceLanguage: params.language,
      targetLanguage: params.targetLanguage,
    }),
    generateSuggestedReplies({
      transcript: params.content,
      language: params.targetLanguage,
      persona: "agent",
      targetTranslationLanguage: shouldTranslateSuggestions ? params.workerLocale : undefined,
    }),
  ])

  return {
    translation,
    suggestions,
  }
}

export interface ConversationTagsResult {
  category: string
  tags: string[]
  summary?: string
}

export interface ConversationMessage {
  body: string
  language: string
  senderRole: string
  createdAt: Date | string
}

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
      const role = msg.senderRole === "WORKER" ? "相談者" : "担当者"
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

  const output = await safeGenerateText(taggingModel, prompt, "conversation-tagging")

  if (!output) {
    const reason = taggingModel ? "分析に失敗しました" : "API設定がありません"
    console.log(`[llm] tagging: ${reason}`)
    return {
      category: "未分類",
      tags: [],
      summary: reason,
    }
  }

  console.log("[llm] Raw tagging output:", output)

  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error("[llm] No JSON found in tagging output")
      return {
        category: "その他",
        tags: [],
        summary: "JSONの解析に失敗しました",
      }
    }

    const parsed = JSON.parse(jsonMatch[0]) as ConversationTagsResult
    console.log("[llm] Parsed tags successfully:", parsed)

    return {
      category: parsed.category || "未分類",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      summary: parsed.summary || undefined,
    }
  } catch (error) {
    console.error("[llm] Failed to parse tags JSON:", error instanceof Error ? error.message : String(error))
    return {
      category: "その他",
      tags: [],
      summary: "タグの解析に失敗しました",
    }
  }
}

export interface ConversationSegment {
  title: string
  summary: string
  messageIds: string[]
  startedAt: Date
  endedAt: Date
}

export interface SegmentationRequest {
  messages: Array<{
    id: string
    body: string
    language: string
    senderRole: string
    createdAt: Date | string
  }>
}

export async function segmentConversation(
  request: SegmentationRequest,
): Promise<ConversationSegment[]> {
  if (request.messages.length === 0) {
    return []
  }

  const transcript = request.messages
    .map((msg, index) => {
      const time = new Date(msg.createdAt).toLocaleString("ja-JP")
      const role = msg.senderRole === "WORKER" ? "相談者" : "担当者"
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

  const output = await safeGenerateText(segmentModel, prompt, "conversation-segmentation")

  if (!output) {
    const reason = segmentModel ? "セグメント分析に失敗しました" : "API設定がありません"
    console.log(`[llm] segmentation: ${reason}`)
    return [{
      title: "会話全体",
      summary: reason,
      messageIds: request.messages.map((m) => m.id),
      startedAt: new Date(request.messages[0].createdAt),
      endedAt: new Date(request.messages[request.messages.length - 1].createdAt),
    }]
  }

  console.log("[llm] Raw segment output:", output.substring(0, 500))

  try {
    const jsonMatch = output.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      console.error("[llm] No JSON array found in segment output")
      throw new Error("JSON array not found")
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      title: string
      summary: string
      startIndex: number
      endIndex: number
    }>

    console.log(`[llm] Parsed ${parsed.length} segments successfully`)

    return parsed
      .map((segment) => {
        const startIdx = Math.max(0, segment.startIndex)
        const endIdx = Math.min(request.messages.length - 1, segment.endIndex)

        if (startIdx > endIdx) {
          console.warn(`[llm] Invalid segment indices: ${startIdx} > ${endIdx}`)
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
    console.error("[llm] Failed to parse segments JSON:", error instanceof Error ? error.message : String(error))
    return [{
      title: "会話全体",
      summary: "セグメントの解析に失敗しました",
      messageIds: request.messages.map((m) => m.id),
      startedAt: new Date(request.messages[0].createdAt),
      endedAt: new Date(request.messages[request.messages.length - 1].createdAt),
    }]
  }
}
