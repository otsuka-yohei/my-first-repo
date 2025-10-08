"use client"

import { ChangeEvent, useEffect, useRef, useState } from "react"
import { useFormStatus } from "react-dom"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { logoutAction } from "@/app/actions/logout"

const LANGUAGE_OPTIONS = [
  { value: "ja", label: "日本語" },
  { value: "vi", label: "ベトナム語" },
  { value: "en", label: "英語" },
]

const LANGUAGE_STORAGE_KEY = "preferredLanguage"

export default function SettingsClient() {
  const [displayName, setDisplayName] = useState("山田 太郎")
  const [language, setLanguage] = useState("ja")
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarName, setAvatarName] = useState<string | null>(null)
  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [preferenceMessage, setPreferenceMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    return () => {
      if (avatarPreview) {
        URL.revokeObjectURL(avatarPreview)
      }
    }
  }, [avatarPreview])

  useEffect(() => {
    if (!profileMessage) return
    const timer = window.setTimeout(() => setProfileMessage(null), 3000)
    return () => window.clearTimeout(timer)
  }, [profileMessage])

  useEffect(() => {
    if (!preferenceMessage) return
    const timer = window.setTimeout(() => setPreferenceMessage(null), 3000)
    return () => window.clearTimeout(timer)
  }, [preferenceMessage])

  useEffect(() => {
    if (typeof window === "undefined") return
    const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (storedLanguage) {
      setLanguage(storedLanguage)
    }
  }, [])

  function handleLanguageChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    setLanguage(value)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, value)
    }
  }

  function handleAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setAvatarName(file.name)
    setAvatarPreview((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev)
      }
      return URL.createObjectURL(file)
    })
  }

  function handleProfileSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProfileMessage("プロフィールを保存しました。実際の保存処理は実装準備中です。")
  }

  function handlePreferenceSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    }
    setPreferenceMessage("言語設定を保存しました。実際の保存処理は実装準備中です。")
  }

  return (
    <div className="flex min-h-full flex-1 flex-col gap-8 bg-muted/20 p-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">個人設定</h1>
        <p className="text-sm text-muted-foreground">
          表示名やプロフィール画像、表示言語を調整して、より使いやすい環境に整えましょう。
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <Card className="border-none bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">プロフィール</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleProfileSubmit} className="space-y-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <Avatar className="h-16 w-16">
                  {avatarPreview ? (
                    <AvatarImage src={avatarPreview} alt="プロフィール画像のプレビュー" />
                  ) : null}
                  <AvatarFallback className="text-base font-semibold">
                    {displayName ? displayName[0] : "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    画像をアップロード
                  </Button>
                  <p className="text-xs text-muted-foreground">PNG、JPG 形式・4MB 以内を推奨</p>
                  {avatarName ? <p className="text-xs">選択中: {avatarName}</p> : null}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={handleAvatarChange}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="display-name">表示名</Label>
                <Input
                  id="display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="山田 太郎"
                />
              </div>

              <div className="flex justify-end">
                <Button type="submit">プロフィールを保存</Button>
              </div>

              {profileMessage ? <p className="text-xs text-muted-foreground">{profileMessage}</p> : null}
            </form>
          </CardContent>
        </Card>

        <Card className="border-none bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">表示言語</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePreferenceSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="language">表示言語</Label>
                <select
                  id="language"
                  value={language}
                  onChange={handleLanguageChange}
                  className="w-full rounded-md border bg-white p-2 text-sm"
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-muted-foreground">
                現在のUIは {LANGUAGE_OPTIONS.find((item) => item.value === language)?.label ?? ""} で表示されます。
              </div>
              <div className="flex justify-end">
                <Button type="submit">言語設定を保存</Button>
              </div>
              {preferenceMessage ? <p className="text-xs text-muted-foreground">{preferenceMessage}</p> : null}
            </form>
          </CardContent>
        </Card>
      </section>

      <Card className="border-none bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">利用中の権限</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>あなたのロール:</span>
          <Badge variant="secondary">MANAGER</Badge>
          <span>所属グループのメンバー管理や相談のエスカレーションが可能です。</span>
        </CardContent>
      </Card>

      <Card className="border-none bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">サインアウト</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-end">
          <form action={logoutAction}>
            <SignOutButton />
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function SignOutButton() {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? "サインアウト中..." : "サインアウト"}
    </Button>
  )
}
