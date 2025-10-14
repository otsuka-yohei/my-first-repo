/**
 * チャット関連のカスタムフック
 */

import { useEffect, useState } from "react"
import { DEFAULT_LANGUAGE } from "./utils"

/**
 * 優先言語を管理するフック
 */
export function usePreferredLanguage(defaultLanguage = DEFAULT_LANGUAGE) {
  const [language, setLanguage] = useState(defaultLanguage)

  useEffect(() => {
    if (typeof window === "undefined") return
    const stored = window.localStorage.getItem("preferredLanguage")
    if (stored) {
      setLanguage(stored)
    }
  }, [defaultLanguage])

  useEffect(() => {
    if (typeof window === "undefined") return
    function handleStorage(event: StorageEvent) {
      if (event.key === "preferredLanguage") {
        setLanguage(event.newValue ?? defaultLanguage)
      }
    }
    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [defaultLanguage])

  return language
}
