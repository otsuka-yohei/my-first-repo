import { LOCALE_LABELS } from "./constants"

/**
 * ロケールを正規化（"ja-JP" -> "ja"）
 */
export function normalizeLocale(locale: string | undefined): string | undefined {
  if (!locale) return undefined
  return locale.split("-")[0].toLowerCase()
}

/**
 * ロケールのラベルを取得
 */
export function getLocaleLabel(locale: string): string {
  const normalized = locale.toLowerCase()
  return LOCALE_LABELS[normalized] || locale
}

/**
 * 年齢を計算
 */
export function calculateAge(dateOfBirth: Date): number {
  const today = new Date()
  const birthDate = new Date(dateOfBirth)
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }

  return age
}

/**
 * 勤続年数を計算
 */
export function calculateYearsOfService(hireDate: Date): string {
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

/**
 * JSONを安全にパース（マークダウンコードブロックを除去）
 */
export function parseJsonSafely<T>(text: string): T | null {
  try {
    let cleanedOutput = text.trim()

    // マークダウンコードブロックを削除
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

    return JSON.parse(cleanedOutput) as T
  } catch (error) {
    console.error("[utils] Failed to parse JSON:", error instanceof Error ? error.message : String(error))
    console.error("[utils] Raw output:", text)
    return null
  }
}

/**
 * JSON配列を安全にパース
 */
export function parseJsonArraySafely<T>(text: string): T[] | null {
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      console.error("[utils] No JSON array found in output")
      return null
    }

    return JSON.parse(jsonMatch[0]) as T[]
  } catch (error) {
    console.error("[utils] Failed to parse JSON array:", error instanceof Error ? error.message : String(error))
    return null
  }
}
