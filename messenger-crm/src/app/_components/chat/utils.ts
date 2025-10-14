/**
 * チャット関連のユーティリティ関数
 */

import type { ConversationSummary, ConversationTag } from "./types"

// デフォルト言語
export const DEFAULT_LANGUAGE = "ja"

// URL検出用の正規表現
const URL_REGEX = /(https?:\/\/[^\s]+)/g

// メッセージプレースホルダー
const MESSAGE_PLACEHOLDERS: Record<string, string> = {
  ja: "メッセージを書く",
  vi: "Viết tin nhắn",
  en: "Write a message",
  id: "Tulis pesan",
  tl: "Mag-type ng mensahe",
  fil: "Mag-type ng mensahe",
}

// ロケールラベルのマッピング
const LOCALE_LABELS: Record<string, string> = {
  ja: "日本語",
  "ja-JP": "日本語",
  vi: "Tiếng Việt",
  "vi-VN": "Tiếng Việt",
  en: "English",
  "en-US": "English",
  id: "Bahasa Indonesia",
  "id-ID": "Bahasa Indonesia",
  tl: "Tagalog",
  "tl-PH": "Tagalog",
}

/**
 * URLを抽出
 */
export function extractUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g
  return text.match(urlRegex) || []
}

/**
 * テキスト内のURLをリンク化
 */
export function linkifyText(text: string) {
  const urls = extractUrls(text)
  if (urls.length === 0) return text

  let result = text
  urls.forEach((url) => {
    result = result.replace(
      url,
      `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">${url}</a>`,
    )
  })
  return result
}

/**
 * 名前からイニシャルを取得
 */
export function getInitials(name?: string | null): string {
  if (!name) return "--"
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * ロケールラベルを取得
 */
export function getLocaleLabel(locale: string): string {
  const normalized = locale.toLowerCase()
  if (normalized in LOCALE_LABELS) {
    return LOCALE_LABELS[normalized]
  }

  const base = normalized.split("-")[0]
  if (base in LOCALE_LABELS) {
    return LOCALE_LABELS[base]
  }

  return locale
}

/**
 * ISO文字列に変換
 */
export function toIsoString(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (value && typeof value === "object" && "toISOString" in value) {
    return (value as Date).toISOString()
  }
  return new Date().toISOString()
}

/**
 * 相対時間をフォーマット
 */
export function formatRelativeTime(isoString: string): string {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diffMs = now - then
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return "今"
  if (diffMins < 60) return `${diffMins}分前`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}時間前`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}日前`

  const diffWeeks = Math.floor(diffDays / 7)
  if (diffWeeks < 4) return `${diffWeeks}週間前`

  const diffMonths = Math.floor(diffDays / 30)
  return `${diffMonths}ヶ月前`
}

/**
 * 提案内容を分割（プライマリとセカンダリ）
 */
export function splitSuggestionContent(content: string): {
  primary: string
  secondary: string
} {
  const normalized = content.replace(/\r\n/g, "\n").trim()
  if (!normalized) {
    return { primary: "", secondary: "" }
  }

  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  if (blocks.length >= 2) {
    return { primary: blocks[0], secondary: blocks.slice(1).join("\n\n") }
  }

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean)
  if (lines.length >= 2) {
    return { primary: lines[0], secondary: lines.slice(1).join("\n") }
  }

  return { primary: normalized, secondary: "" }
}

/**
 * プレースホルダーコードを解決
 */
export function resolvePlaceholder(code: string | null | undefined): string {
  if (!code) return ""
  if (code === "{{worker.name}}") return "メンバー"
  if (code === "{{manager.name}}") return "マネージャー"
  return code
}

/**
 * メッセージプレースホルダーを取得
 */
export function getMessagePlaceholder(
  preferredLanguage: string,
  fallback?: string | null,
): string {
  if (fallback) return resolvePlaceholder(fallback)

  if (preferredLanguage === "vi") {
    return "Nhập tin nhắn..."
  }
  if (preferredLanguage === "en") {
    return "Type a message..."
  }
  return "メッセージを入力..."
}

/**
 * 会話のタグを構築
 */
export function buildConversationTags(
  conversation: ConversationSummary | (import("./types").ConversationDetail & { messages: import("./types").MessageItem[] }),
  removedIds: string[] = [],
  manualLabels: string[] = [],
): ConversationTag[] {
  const excluded = new Set(removedIds)
  const tags: ConversationTag[] = []
  const seen = new Set<string>()

  const pushTag = (tag: ConversationTag) => {
    if (excluded.has(tag.id) || seen.has(tag.id)) {
      return
    }
    seen.add(tag.id)
    tags.push(tag)
  }

  if (conversation.group?.name) {
    pushTag({ id: `group-${conversation.group.id}`, label: conversation.group.name, kind: "auto" })
  }

  const category = conversation.consultation?.category
  if (category) {
    pushTag({ id: `category-${category}`, label: category, kind: "auto" })
  }

  if (conversation.consultation?.priority === "HIGH") {
    pushTag({ id: `${conversation.id}-urgent`, label: "緊急", tone: "urgent", kind: "auto" })
  }

  manualLabels.forEach((label) => {
    const trimmed = label.trim()
    if (!trimmed) return
    const manualId = `manual-${trimmed.toLowerCase()}`
    pushTag({ id: manualId, label: trimmed, kind: "manual" })
  })

  return tags
}
