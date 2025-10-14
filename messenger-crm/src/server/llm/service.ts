import "server-only"

import { GoogleGenerativeAI } from "@google/generative-ai"

import { env } from "@/server/env"

const TRANSLATE_MODEL = "gemini-2.5-flash-lite"
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

const HEALTH_CONSULTATION_MODEL = "gemini-2.5-flash-lite" // Lite版で高速化
const healthConsultationModel = env.GOOGLE_SUGGEST_API_KEY
  ? new GoogleGenerativeAI(env.GOOGLE_SUGGEST_API_KEY).getGenerativeModel({
      model: HEALTH_CONSULTATION_MODEL,
    })
  : null

const IMAGE_ANALYSIS_MODEL = "gemini-2.5-flash" // 画像解析用モデル
const imageAnalysisModel = env.GOOGLE_SUGGEST_API_KEY
  ? new GoogleGenerativeAI(env.GOOGLE_SUGGEST_API_KEY).getGenerativeModel({
      model: IMAGE_ANALYSIS_MODEL,
    })
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
  const startTime = Date.now()
  console.log(`[llm] translate: Starting ${request.sourceLanguage} -> ${request.targetLanguage} (${request.content.length} chars)`)

  // キャッシュをチェック
  const cachedTranslation = getCachedTranslation(request.content, request.sourceLanguage, request.targetLanguage)
  if (cachedTranslation) {
    const duration = Date.now() - startTime
    console.log(`[llm] translate: Cache hit (${duration}ms)`)
    return {
      translation: cachedTranslation,
      provider: "google-ai-studio",
      model: TRANSLATE_MODEL,
      warnings: ["Translation retrieved from cache"],
    }
  }

  const prompt =
    `You are a translator specializing in internal workplace communications between managers and part-time employees.\n\n` +
    `Translate the following message from ${request.sourceLanguage} to ${request.targetLanguage}.\n\n` +
    `IMPORTANT Guidelines:\n` +
    `- Match the tone of the original message - it can be casual, friendly, or formal depending on the context\n` +
    `- This is internal workplace communication, NOT customer support, so professional formality is not required\n` +
    `- Preserve the original meaning, intent, and emotional tone\n` +
    `- Use natural, conversational language that native speakers would use in workplace chat\n` +
    `- Return ONLY the translated text, without any additional explanation or formatting\n` +
    `- If the message is too short, unclear, or contains only random characters, translate it literally without any explanation\n` +
    `- NEVER return messages asking for clarification or explaining that translation is not possible\n` +
    `- If you cannot translate meaningfully, return the original text exactly as provided\n\n` +
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

  // バリデーション: LLMが説明文を返したかチェック
  const lowerOutput = output.toLowerCase()
  const isExplanation =
    lowerOutput.includes('please provide') ||
    lowerOutput.includes('vui lòng cung cấp') ||
    lowerOutput.includes('xin vui lòng') ||
    lowerOutput.includes('提供') ||
    lowerOutput.includes('ください') ||
    lowerOutput.includes('cannot translate') ||
    lowerOutput.includes('unable to translate') ||
    lowerOutput.includes('không thể dịch') ||
    // 出力が入力の3倍以上長い場合も説明文の可能性が高い
    output.length > request.content.length * 3

  if (isExplanation) {
    console.log(`[llm] translate: Detected explanation response, returning original content`)
    return {
      translation: request.content,
      provider: "google-ai-studio",
      model: TRANSLATE_MODEL,
      warnings: ["Translation uncertain; returning original text"],
    }
  }

  // キャッシュに保存
  setCachedTranslation(request.content, request.sourceLanguage, request.targetLanguage, output)

  const duration = Date.now() - startTime
  console.log(`[llm] translate: Success ${request.sourceLanguage} -> ${request.targetLanguage} (${duration}ms)`)
  return {
    translation: output,
    provider: "google-ai-studio",
    model: TRANSLATE_MODEL,
  }
}

export interface EnhancedSuggestionRequest {
  conversationHistory: Array<{
    body: string
    senderRole: string
    createdAt: Date | string
  }>
  workerInfo: {
    name?: string | null
    locale?: string | null
    countryOfOrigin?: string | null
    dateOfBirth?: Date | null
    gender?: string | null
    address?: string | null
    phoneNumber?: string | null
    jobDescription?: string | null
    hireDate?: Date | null
    notes?: string | null
  }
  groupInfo?: {
    name?: string | null
    phoneNumber?: string | null
    address?: string | null
  }
  language: string
  persona: "agent" | "manager"
  targetTranslationLanguage?: string
  daysSinceLastWorkerMessage?: number
}

export async function generateSuggestedReplies(
  request: SuggestionRequest | EnhancedSuggestionRequest,
): Promise<SuggestedReply[]> {
  // 後方互換性のため、古い形式もサポート
  const isEnhanced = 'conversationHistory' in request

  let prompt: string
  let operationName: string

  if (isEnhanced) {
    // 新しい形式: 会話履歴とユーザー情報を参照
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

    // マネージャー連投かどうかを判定
    const lastMessages = request.conversationHistory.slice(-3)
    const consecutiveManagerMessages = lastMessages.filter(msg => msg.senderRole !== "MEMBER").length
    const isManagerConsecutive = consecutiveManagerMessages >= 2

    // ワーカーからの最後のメッセージからの経過日数
    const daysSince = request.daysSinceLastWorkerMessage ?? 0

    let contextDescription = ""
    let tones = ["question", "empathy", "solution"]

    // 初回メッセージの検出
    const isInitialMessage = recentMessages.length === 0

    if (isInitialMessage) {
      // 初回メッセージ: ウェルカムメッセージ
      contextDescription = `${workerName}さん（${workerLocale}話者）への初回メッセージを作成してください。「このチャットで、業務上の相談やシフト、何か困ったことがあればなんでもメッセージを送ってください。」という趣旨の温かく親しみやすいメッセージを3パターン提案してください。`
      tones = ["welcome", "welcome", "welcome"]
    } else {
      // 健康相談の検出
      const recentWorkerMessages = recentMessages.filter(msg => msg.senderRole === "MEMBER").slice(-3)
      const lastWorkerMessage = recentWorkerMessages[recentWorkerMessages.length - 1]
      const isHealthRelated = lastWorkerMessage?.body && (
        /体調|痛|怪我|ケガ|病気|熱|風邪|頭痛|腹痛|咳|吐き気|めまい|病院|医者|診察/.test(lastWorkerMessage.body)
      )

      if (isHealthRelated) {
        // 健康相談の場合、症状確認や病院探しをサポート
        contextDescription = `${workerName}さん（${workerLocale}話者）から健康相談がありました。症状の詳細、いつ病院に行きたいか、怪我の場合は労災の可能性（仕事中か等）を確認し、必要に応じて病院探しをサポートしてください。住所: ${workerDetails.includes("住所:") ? workerDetails.find(d => d.startsWith("住所:")) : "未登録"}`
        tones = ["empathy", "question", "solution"]
      } else if (daysSince > 7) {
        // 7日以上経過: チェックイン型のメッセージ
        contextDescription = `前回の会話から1週間以上経過しています。${workerName}さん（${workerLocale}話者）の現在の状況や悩みを確認する、温かみのあるメッセージを提案してください。`
        tones = ["check-in", "check-in", "check-in"]
      } else if (daysSince > 3) {
        // 3日以上経過: フォローアップ型
        contextDescription = `前回の会話から3日以上経過しています。${workerName}さん（${workerLocale}話者）について、前回の話題について優しくフォローアップするメッセージを提案してください。`
        tones = ["gentle-follow-up", "gentle-follow-up", "continuation"]
      } else if (isManagerConsecutive) {
        // マネージャー連投: 継続・励まし型
        contextDescription = `マネージャーが連続してメッセージを送信しています。${workerName}さん（${workerLocale}話者）が安心して返信できるような、継続や励ましのメッセージを提案してください。`
        tones = ["continuation", "encouragement", "empathy"]
      } else {
        // 通常の返信
        contextDescription = `${workerName}さん（${workerLocale}話者）からのメッセージに対して、適切な返信を提案してください。`
        tones = ["question", "empathy", "solution"]
      }
    }

    // メンバー情報セクション
    const workerInfoSection = workerDetails.length > 0
      ? `\n\n### メンバー情報:\n${workerDetails.join("\n")}`
      : ""

    // グループ情報セクション
    const groupInfoSection = groupDetails.length > 0
      ? `\n\n### グループ情報:\n${groupDetails.join("\n")}`
      : ""

    prompt =
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

    operationName = `enhanced-suggestions-${request.language}`
  } else {
    // 古い形式: 単一メッセージのみ参照（後方互換性）
    prompt =
      `You are an empathetic support ${request.persona}. Based on the following customer transcript, ` +
      `suggest exactly 3 concise replies in ${request.language}.\n\n` +
      `IMPORTANT: Return ONLY the replies in this exact format (one per line):\n` +
      `question: [your question reply here]\n` +
      `empathy: [your empathetic reply here]\n` +
      `solution: [your solution-oriented reply here]\n\n` +
      `Do NOT include any other text, numbering, or markdown formatting.\n\n` +
      `Transcript:\n${request.transcript}`

    operationName = `suggestions-${request.language}`
  }

  const output = await safeGenerateText(suggestModel, prompt, operationName)

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

function normalizeLocale(locale: string | undefined): string | undefined {
  if (!locale) return undefined
  // "ja-JP" -> "ja", "vi-VN" -> "vi"
  return locale.split("-")[0].toLowerCase()
}

function getLocaleLabel(locale: string): string {
  const normalized = locale.toLowerCase()
  switch (normalized) {
    case "ja":
    case "ja-jp":
      return "日本語"
    case "vi":
    case "vi-vn":
      return "ベトナム語"
    case "en":
    case "en-us":
      return "英語"
    case "id":
    case "id-id":
      return "インドネシア語"
    case "tl":
    case "fil":
      return "タガログ語"
    default:
      return locale
  }
}

function calculateAge(dateOfBirth: Date): number {
  const today = new Date()
  const birthDate = new Date(dateOfBirth)
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }

  return age
}

function calculateYearsOfService(hireDate: Date): string {
  const today = new Date()
  const hire = new Date(hireDate)
  const years = today.getFullYear() - hire.getFullYear()
  const months = today.getMonth() - hire.getMonth()

  let totalMonths = years * 12 + months
  if (today.getDate() < hire.getDate()) {
    totalMonths--
  }

  const serviceYears = Math.floor(totalMonths / 12)
  const serviceMonths = totalMonths % 12

  if (serviceYears === 0) {
    return `${serviceMonths}ヶ月`
  } else if (serviceMonths === 0) {
    return `${serviceYears}年`
  } else {
    return `${serviceYears}年${serviceMonths}ヶ月`
  }
}

export async function enrichMessageWithLLM(params: {
  content: string
  language: string
  targetLanguage: string
  workerLocale?: string
  managerLocale?: string
  conversationHistory?: Array<{
    body: string
    senderRole: string
    createdAt: Date | string
  }>
  workerInfo?: {
    name?: string | null
    locale?: string | null
    countryOfOrigin?: string | null
    dateOfBirth?: Date | null
    gender?: string | null
    address?: string | null
    phoneNumber?: string | null
    jobDescription?: string | null
    hireDate?: Date | null
    notes?: string | null
  }
  groupInfo?: {
    name?: string | null
    phoneNumber?: string | null
    address?: string | null
  }
  daysSinceLastWorkerMessage?: number
  isInitialMessage?: boolean
}): Promise<EnrichmentResult> {
  // ログイン中のマネージャーの表示言語でAI返信を生成
  // マネージャーの言語とワーカーの言語が異なる場合、ワーカーの言語での翻訳を追加
  const normalizedManagerLocale = normalizeLocale(params.managerLocale)
  const normalizedWorkerLocale = normalizeLocale(params.workerLocale)

  // AI返信はマネージャーの表示言語で生成（デフォルト: 日本語）
  const suggestionLanguage = normalizedManagerLocale ?? "ja"

  // マネージャーとワーカーの言語が異なる場合のみ翻訳を追加
  const shouldTranslateSuggestions = normalizedWorkerLocale &&
    normalizedManagerLocale &&
    normalizedWorkerLocale !== normalizedManagerLocale

  // まず翻訳を先に実行（ユーザーに即座に表示するため）
  const translation = params.content && params.language !== params.targetLanguage
    ? await translateMessage({
        content: params.content,
        sourceLanguage: params.language,
        targetLanguage: params.targetLanguage,
      })
    : undefined

  // 翻訳完了後にAI提案を生成（バックグラウンド処理として）
  const suggestions = params.isInitialMessage && params.workerInfo
    ? await generateSuggestedReplies({
        conversationHistory: [],
        workerInfo: params.workerInfo,
        groupInfo: params.groupInfo,
        language: suggestionLanguage,
        persona: "manager",
        targetTranslationLanguage: shouldTranslateSuggestions ? normalizedWorkerLocale : undefined,
        daysSinceLastWorkerMessage: 0,
      } as EnhancedSuggestionRequest)
    : params.conversationHistory && params.workerInfo
    ? await generateSuggestedReplies({
        conversationHistory: params.conversationHistory,
        workerInfo: params.workerInfo,
        groupInfo: params.groupInfo,
        language: suggestionLanguage,
        persona: "manager",
        targetTranslationLanguage: shouldTranslateSuggestions ? normalizedWorkerLocale : undefined,
        daysSinceLastWorkerMessage: params.daysSinceLastWorkerMessage,
      } as EnhancedSuggestionRequest)
    : await generateSuggestedReplies({
        transcript: params.content,
        language: suggestionLanguage,
        persona: "agent",
        targetTranslationLanguage: shouldTranslateSuggestions ? normalizedWorkerLocale : undefined,
      })

  return {
    translation,
    suggestions,
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
  preferredDate?: string // "today" | "tomorrow" | "this_week" | "specific_date"
  specificDate?: string // "2025-01-15"のような形式
  timePreference?: string // "morning" | "afternoon" | "evening"
}> {
  if (!healthConsultationModel) {
    console.log("[llm] Health consultation model not configured")
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

  const output = await safeGenerateText(healthConsultationModel, prompt, "consultation-intent-analysis")

  if (!output) {
    console.log("[llm] Failed to analyze consultation intent")
    return { wantsConsultation: false }
  }

  try {
    // マークダウンコードブロックを削除
    let cleanedOutput = output.trim()
    const codeBlockMatch = cleanedOutput.match(/^```(?:json)?\n?([\s\S]*?)\n?```$/)
    if (codeBlockMatch) {
      cleanedOutput = codeBlockMatch[1].trim()
    }

    const result = JSON.parse(cleanedOutput)
    console.log("[llm] Consultation intent analysis:", result)
    return result
  } catch (error) {
    console.error("[llm] Failed to parse consultation intent:", error)
    console.error("[llm] Raw output:", output)
    return { wantsConsultation: false }
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

export interface HealthConsultationAnalysis {
  isHealthRelated: boolean
  symptomType?: string // 例: "内科", "外科", "歯科"
  urgency?: "immediate" | "today" | "this_week" | "flexible"
  needsMedicalFacility?: boolean
  hasAddress?: boolean
  injuryContext?: string // 労災の可能性を判断するための情報
  suggestedQuestions?: string[] // ワーカーに聞くべき質問
}

/**
 * 会話を分析して健康相談かどうかを判定し、必要な情報を抽出
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
    console.log("[llm] Health consultation model not configured")
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

  const output = await safeGenerateText(healthConsultationModel, prompt, "health-consultation-analysis")

  if (!output) {
    console.log("[llm] Failed to analyze health consultation")
    return { isHealthRelated: false }
  }

  try {
    // マークダウンコードブロックを削除（```json...```や```...```）
    let cleanedOutput = output.trim()
    const codeBlockMatch = cleanedOutput.match(/^```(?:json)?\n?([\s\S]*?)\n?```$/)
    if (codeBlockMatch) {
      cleanedOutput = codeBlockMatch[1].trim()
    }

    const analysis = JSON.parse(cleanedOutput) as HealthConsultationAnalysis
    console.log("[llm] Health consultation analysis:", analysis)
    return analysis
  } catch (error) {
    console.error("[llm] Failed to parse health consultation analysis:", error)
    console.error("[llm] Raw output:", output)
    return { isHealthRelated: false }
  }
}

/**
 * 画像を解析してテキスト説明を生成
 */
export interface ImageAnalysisRequest {
  imageUrl: string
  userMessage?: string // ユーザーが送信したテキストメッセージ
  workerLocale?: string
}

export interface ImageAnalysisResult {
  description: string // 画像の内容説明
  documentType?: string // 書類の種類（例: "年金手帳", "保険証", "通知書"）
  urgency?: "high" | "medium" | "low" // 緊急度
  suggestedActions?: string[] // 推奨される対応
  extractedText?: string // 画像から抽出されたテキスト
}

export async function analyzeImage(
  request: ImageAnalysisRequest,
): Promise<ImageAnalysisResult | null> {
  if (!imageAnalysisModel) {
    console.log("[llm] Image analysis model not configured")
    return null
  }

  try {
    console.log(`[llm] Analyzing image: ${request.imageUrl}`)

    // 画像をダウンロード
    const response = await fetch(request.imageUrl)
    if (!response.ok) {
      console.error(`[llm] Failed to fetch image: ${response.status} ${response.statusText}`)
      return null
    }

    const imageBuffer = await response.arrayBuffer()
    const mimeType = response.headers.get("content-type") || "image/jpeg"
    const base64Image = Buffer.from(imageBuffer).toString("base64")

    console.log(`[llm] Image downloaded: ${mimeType}, size: ${imageBuffer.byteLength} bytes`)

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
    console.log("[llm] Image analysis raw output:", text.substring(0, 500))

    // JSONを抽出
    let cleanedOutput = text
    const codeBlockMatch = cleanedOutput.match(/^```(?:json)?\n?([\s\S]*?)\n?```$/)
    if (codeBlockMatch) {
      cleanedOutput = codeBlockMatch[1].trim()
    } else {
      // JSONブロックが見つからない場合、{}で囲まれた部分を抽出
      const jsonMatch = cleanedOutput.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        cleanedOutput = jsonMatch[0]
      }
    }

    const analysis = JSON.parse(cleanedOutput) as ImageAnalysisResult
    console.log("[llm] Image analysis completed:", analysis)

    return analysis
  } catch (error) {
    console.error("[llm] Image analysis failed:", error instanceof Error ? error.message : String(error))
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
    console.log("[llm] Suggest model not configured")
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

  const output = await safeGenerateText(suggestModel, prompt, "image-based-suggestions")

  if (!output) {
    console.log("[llm] Failed to generate image-based suggestions")
    return []
  }

  console.log("[llm] Raw image-based suggestion output:", output)

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

  console.log("[llm] Parsed image-based suggestions:", JSON.stringify(suggestions, null, 2))

  return suggestions
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

