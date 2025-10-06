import "server-only"

import { GoogleGenerativeAI } from "@google/generative-ai"

import { env } from "@/server/env"

const TRANSLATE_MODEL = "gemini-1.5-flash"
const SUGGEST_MODEL = "gemini-1.5-flash"

const translateModel = env.GOOGLE_TRANSLATE_API_KEY
  ? new GoogleGenerativeAI(env.GOOGLE_TRANSLATE_API_KEY).getGenerativeModel({ model: TRANSLATE_MODEL })
  : null

const suggestModel = env.GOOGLE_SUGGEST_API_KEY
  ? new GoogleGenerativeAI(env.GOOGLE_SUGGEST_API_KEY).getGenerativeModel({ model: SUGGEST_MODEL })
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
}

export interface SuggestionRequest {
  transcript: string
  language: string
  persona: "agent" | "manager"
}

export interface EnrichmentResult {
  translation?: TranslationResult
  suggestions?: SuggestedReply[]
}

async function safeGenerateText(model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]> | null, prompt: string) {
  if (!model) {
    return null
  }

  try {
    const result = await model.generateContent(prompt)
    return result.response.text().trim()
  } catch (error) {
    console.error("[llm] generation failed", error)
    return null
  }
}

export async function translateMessage(
  request: TranslationRequest,
): Promise<TranslationResult> {
  const prompt = `Translate the following message from ${request.sourceLanguage} to ${request.targetLanguage}.\nMessage:\n${request.content}`
  const output = await safeGenerateText(translateModel, prompt)

  if (!output) {
    return {
      translation: request.content,
      provider: translateModel ? "google-ai-studio" : "mock",
      model: translateModel ? TRANSLATE_MODEL : "offline",
      warnings: translateModel
        ? ["Translation request failed; returning original content."]
        : ["GOOGLE_TRANSLATE_API_KEY not set; returning original content"],
    }
  }

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
    `suggest up to three concise replies in ${request.language}. ` +
    `Return each reply on its own line, prefixed by the tone (question/empathy/solution) followed by a colon.\nTranscript:\n${request.transcript}`

  const output = await safeGenerateText(suggestModel, prompt)

  if (!output) {
    if (!suggestModel) {
      return [
        {
          content: "LLM が無効のため、ここに提案が表示されます。",
          tone: "solution",
          language: request.language,
        },
      ]
    }
    return []
  }

  return output
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const [toneLabel, ...rest] = line.split(":")
      const toneCandidate = toneLabel?.trim().toLowerCase() as SuggestedReply["tone"] | undefined
      const tone: SuggestedReply["tone"] = toneCandidate && ["question", "empathy", "solution"].includes(toneCandidate)
        ? toneCandidate
        : "solution"
      const content = rest.join(":").trim() || line
      return {
        content,
        tone,
        language: request.language,
      }
    })
}

export async function enrichMessageWithLLM(params: {
  content: string
  language: string
  targetLanguage: string
}): Promise<EnrichmentResult> {
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
    }),
  ])

  return {
    translation,
    suggestions,
  }
}
