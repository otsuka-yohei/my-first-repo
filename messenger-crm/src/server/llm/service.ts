import "server-only"

import { Prisma } from "@prisma/client"

// 型定義をエクスポート
export type {
  TranslationRequest,
  TranslationResult,
  SuggestedReply,
  SuggestionRequest,
  EnhancedSuggestionRequest,
  EnrichmentResult,
  ConversationTagsResult,
  ConversationMessage,
  ConversationSegment,
  SegmentationRequest,
  HealthConsultationAnalysis,
  ImageAnalysisRequest,
  ImageAnalysisResult,
} from "./types"

// 定数をエクスポート
export { MODELS, CACHE_CONFIG, LOCALE_LABELS } from "./constants"

// 各機能をエクスポート
export { translateMessage } from "./translation"
export { analyzeImage, generateImageBasedReplies } from "./image-analysis"
export { analyzeHealthConsultation, analyzeConsultationIntent } from "./health-consultation"
export { generateSuggestedReplies } from "./suggestions"
export { generateConversationTags, segmentConversation } from "./conversation-analysis"

// ユーティリティ関数をエクスポート
export { normalizeLocale, getLocaleLabel, calculateAge, calculateYearsOfService } from "./utils"

// 既存のenrichMessageWithLLM関数（後方互換性のため維持）
import { translateMessage } from "./translation"
import { generateSuggestedReplies } from "./suggestions"
import { normalizeLocale } from "./utils"
import type { EnrichmentResult, EnhancedSuggestionRequest } from "./types"

/**
 * メッセージをLLMで拡張（翻訳 + AI提案）
 */
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
  // マネージャーの表示言語でAI返信を生成
  const normalizedManagerLocale = normalizeLocale(params.managerLocale)
  const normalizedWorkerLocale = normalizeLocale(params.workerLocale)

  const suggestionLanguage = normalizedManagerLocale ?? "ja"

  // マネージャーとワーカーの言語が異なる場合のみ翻訳を追加
  const shouldTranslateSuggestions = normalizedWorkerLocale &&
    normalizedManagerLocale &&
    normalizedWorkerLocale !== normalizedManagerLocale

  // まず翻訳を実行
  const translation = params.content && params.language !== params.targetLanguage
    ? await translateMessage({
        content: params.content,
        sourceLanguage: params.language,
        targetLanguage: params.targetLanguage,
      })
    : undefined

  // AI提案を生成
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
