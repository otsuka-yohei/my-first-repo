import "server-only"

import { GoogleGenerativeAI } from "@google/generative-ai"

import { env } from "@/server/env"

import { MODELS, CACHE_CONFIG, TOKEN_ESTIMATION_FACTOR } from "./constants"
import type { TranslationRequest, TranslationResult } from "./types"

// 翻訳キャッシュ（メモリベース）
const translationCache = new Map<string, { translation: string; timestamp: number }>()

const translateModel = env.GOOGLE_TRANSLATE_API_KEY
  ? new GoogleGenerativeAI(env.GOOGLE_TRANSLATE_API_KEY).getGenerativeModel({ model: MODELS.TRANSLATE })
  : null

/**
 * キャッシュキーを生成
 */
function getCacheKey(content: string, sourceLang: string, targetLang: string): string {
  return `${sourceLang}:${targetLang}:${content.substring(0, 200)}`
}

/**
 * キャッシュから翻訳を取得
 */
function getCachedTranslation(content: string, sourceLang: string, targetLang: string): string | null {
  const key = getCacheKey(content, sourceLang, targetLang)
  const cached = translationCache.get(key)

  if (!cached) {
    return null
  }

  const age = Date.now() - cached.timestamp
  if (age < CACHE_CONFIG.TTL_MILLISECONDS) {
    console.log(`[translation] Cache hit (age: ${Math.round(age / 1000)}s)`)
    return cached.translation
  }

  translationCache.delete(key)
  return null
}

/**
 * 翻訳をキャッシュに保存
 */
function setCachedTranslation(content: string, sourceLang: string, targetLang: string, translation: string): void {
  // キャッシュサイズ制限を超えた場合、古いエントリを削除
  if (translationCache.size >= CACHE_CONFIG.MAX_SIZE) {
    const oldestKey = translationCache.keys().next().value
    if (oldestKey) {
      translationCache.delete(oldestKey)
      console.log(`[translation] Cache eviction (size: ${translationCache.size})`)
    }
  }

  const key = getCacheKey(content, sourceLang, targetLang)
  translationCache.set(key, { translation, timestamp: Date.now() })
}

/**
 * LLM出力が説明文かどうかを判定
 */
function isExplanationResponse(output: string, originalContent: string): boolean {
  const lowerOutput = output.toLowerCase()

  const explanationKeywords = [
    'please provide',
    'vui lòng cung cấp',
    'xin vui lòng',
    '提供',
    'ください',
    'cannot translate',
    'unable to translate',
    'không thể dịch',
  ]

  const hasExplanationKeyword = explanationKeywords.some(keyword => lowerOutput.includes(keyword))
  const isTooLong = output.length > originalContent.length * 3

  return hasExplanationKeyword || isTooLong
}

/**
 * LLMを使用して安全にテキストを生成
 */
async function safeGenerateText(
  model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]> | null,
  prompt: string,
  operationName = "generate"
): Promise<string | null> {
  if (!model) {
    console.log(`[translation] ${operationName}: Model not configured, skipping`)
    return null
  }

  const startTime = Date.now()

  try {
    console.log(`[translation] ${operationName}: Starting (prompt length: ${prompt.length} chars)`)

    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()

    const duration = Date.now() - startTime
    const inputTokens = Math.ceil(prompt.length / TOKEN_ESTIMATION_FACTOR)
    const outputTokens = Math.ceil(text.length / TOKEN_ESTIMATION_FACTOR)

    console.log(`[translation] ${operationName}: Success (${duration}ms, ~${inputTokens + outputTokens} tokens)`)

    return text
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[translation] ${operationName}: Failed after ${duration}ms -`, error instanceof Error ? error.message : String(error))

    if (error instanceof Error && "response" in error) {
      console.error(`[translation] ${operationName}: API response:`, JSON.stringify(error, null, 2))
    }

    return null
  }
}

/**
 * メッセージを翻訳
 */
export async function translateMessage(request: TranslationRequest): Promise<TranslationResult> {
  const startTime = Date.now()
  console.log(`[translation] Starting ${request.sourceLanguage} -> ${request.targetLanguage} (${request.content.length} chars)`)

  // キャッシュをチェック
  const cachedTranslation = getCachedTranslation(request.content, request.sourceLanguage, request.targetLanguage)
  if (cachedTranslation) {
    const duration = Date.now() - startTime
    console.log(`[translation] Cache hit (${duration}ms)`)
    return {
      translation: cachedTranslation,
      provider: "google-ai-studio",
      model: MODELS.TRANSLATE,
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
    console.log(`[translation] ${reason}; returning original content`)
    return {
      translation: request.content,
      provider: translateModel ? "google-ai-studio" : "mock",
      model: translateModel ? MODELS.TRANSLATE : "offline",
      warnings: [`${reason}; returning original content.`],
    }
  }

  // 説明文が返された場合は元のテキストを返す
  if (isExplanationResponse(output, request.content)) {
    console.log(`[translation] Detected explanation response, returning original content`)
    return {
      translation: request.content,
      provider: "google-ai-studio",
      model: MODELS.TRANSLATE,
      warnings: ["Translation uncertain; returning original text"],
    }
  }

  // キャッシュに保存
  setCachedTranslation(request.content, request.sourceLanguage, request.targetLanguage, output)

  const duration = Date.now() - startTime
  console.log(`[translation] Success ${request.sourceLanguage} -> ${request.targetLanguage} (${duration}ms)`)

  return {
    translation: output,
    provider: "google-ai-studio",
    model: MODELS.TRANSLATE,
  }
}
