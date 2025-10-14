/**
 * LLMサービス層の定数定義
 */

// モデル名
export const MODELS = {
  TRANSLATE: "gemini-2.5-flash-lite",
  SUGGEST: "gemini-2.5-flash",
  TAGGING: "gemini-2.5-flash",
  SEGMENT: "gemini-2.5-flash",
  HEALTH_CONSULTATION: "gemini-2.5-flash-lite",
  IMAGE_ANALYSIS: "gemini-2.5-flash",
} as const

// キャッシュ設定
export const CACHE_CONFIG = {
  MAX_SIZE: 500,
  TTL_MILLISECONDS: 60 * 60 * 1000, // 1時間
} as const

// ロケール設定
export const LOCALE_LABELS: Record<string, string> = {
  ja: "日本語",
  "ja-jp": "日本語",
  vi: "ベトナム語",
  "vi-vn": "ベトナム語",
  en: "英語",
  "en-us": "英語",
  id: "インドネシア語",
  "id-id": "インドネシア語",
  tl: "タガログ語",
  fil: "タガログ語",
} as const

// 診療科の種類
export const SYMPTOM_TYPES = [
  "内科",
  "外科",
  "整形外科",
  "歯科",
  "皮膚科",
  "耳鼻咽喉科",
  "眼科",
] as const

// 緊急度
export const URGENCY_LEVELS = ["immediate", "today", "this_week", "flexible"] as const

// トークン推定係数（1文字あたりのトークン数の概算）
export const TOKEN_ESTIMATION_FACTOR = 4
