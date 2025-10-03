import "server-only"

import OpenAI from "openai"

import { env } from "@/server/env"

const DEFAULT_MODEL = "gpt-4o-mini"

const openaiClient = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
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

export async function translateMessage(
  request: TranslationRequest,
): Promise<TranslationResult> {
  if (!openaiClient) {
    return {
      translation: request.content,
      provider: "mock",
      model: "offline",
      warnings: ["OPENAI_API_KEY not set; returning original content"],
    }
  }

  const response = await openaiClient.responses.create({
    model: DEFAULT_MODEL,
    input: `Translate the following message from ${request.sourceLanguage} to ${request.targetLanguage}.\nMessage:\n${request.content}`,
  })

  const translation = response.output_text?.trim() ?? request.content

  return {
    translation,
    provider: "openai",
    model: DEFAULT_MODEL,
  }
}

export async function generateSuggestedReplies(
  request: SuggestionRequest,
): Promise<SuggestedReply[]> {
  if (!openaiClient) {
    return [
      {
        content: "LLM が無効のため、ここに提案が表示されます。",
        tone: "solution",
        language: request.language,
      },
    ]
  }

  const response = await openaiClient.responses.create({
    model: DEFAULT_MODEL,
    input: `You are an empathetic support agent. Based on the following customer transcript, suggest up to three short replies in ${request.language}.\n` +
      `Return them as bullet points prefixed with the tone (question/empathy/solution).\nTranscript:\n${request.transcript}`,
  })

  const output = response.output_text?.trim() ?? ""

  return output
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const [toneLabel, ...rest] = line.split(":")
      const tone = toneLabel?.toLowerCase() as SuggestedReply["tone"] | undefined
      const content = rest.join(":").trim() || line
      return {
        content,
        tone: tone && ["question", "empathy", "solution"].includes(tone) ? tone : "solution",
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
