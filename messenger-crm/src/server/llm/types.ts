/**
 * LLMサービス層の型定義
 */

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

export interface EnrichmentResult {
  translation?: TranslationResult
  suggestions?: SuggestedReply[]
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
  symptomType?: string
  urgency?: "immediate" | "today" | "this_week" | "flexible"
  needsMedicalFacility?: boolean
  hasAddress?: boolean
  injuryContext?: string
  suggestedQuestions?: string[]
}

export interface ImageAnalysisRequest {
  imageUrl: string
  userMessage?: string
  workerLocale?: string
}

export interface ImageAnalysisResult {
  description: string
  documentType?: string
  urgency?: "high" | "medium" | "low"
  suggestedActions?: string[]
  extractedText?: string
}
