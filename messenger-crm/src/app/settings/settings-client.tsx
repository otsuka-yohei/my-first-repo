"use client"

import { ChangeEvent, useEffect, useRef, useState } from "react"
import { useFormStatus } from "react-dom"
import { UserRole } from "@prisma/client"

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

const ROLE_LABELS: Record<UserRole, string> = {
  SYSTEM_ADMIN: "システム管理者",
  AREA_MANAGER: "エリアマネージャー",
  MANAGER: "マネージャー",
  MEMBER: "メンバー",
}

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  SYSTEM_ADMIN: "システム全体の管理が可能です。",
  AREA_MANAGER: "複数グループの管理が可能です。",
  MANAGER: "所属グループのメンバー管理や相談のエスカレーションが可能です。",
  MEMBER: "自分の相談のみ閲覧・対応できます。",
}

interface CurrentUser {
  id: string
  name: string
  email: string
  role: UserRole
  locale: string
  avatarUrl?: string | null
  countryOfOrigin?: string | null
  dateOfBirth?: string | null
  gender?: string | null
  address?: string | null
  phoneNumber?: string | null
  jobDescription?: string | null
  hireDate?: string | null
}

interface SettingsClientProps {
  currentUser: CurrentUser
}

export default function SettingsClient({ currentUser }: SettingsClientProps) {
  const [displayName, setDisplayName] = useState(currentUser.name)
  const [language, setLanguage] = useState(currentUser.locale)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(currentUser.avatarUrl || null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarName, setAvatarName] = useState<string | null>(null)
  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [preferenceMessage, setPreferenceMessage] = useState<string | null>(null)
  const [isProfileSaving, setIsProfileSaving] = useState(false)
  const [isPreferenceSaving, setIsPreferenceSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 詳細情報
  const [countryOfOrigin, setCountryOfOrigin] = useState(currentUser.countryOfOrigin || "")
  const [dateOfBirth, setDateOfBirth] = useState(
    currentUser.dateOfBirth ? new Date(currentUser.dateOfBirth).toISOString().split("T")[0] : ""
  )
  const [gender, setGender] = useState(currentUser.gender || "")
  const [address, setAddress] = useState(currentUser.address || "")
  const [phoneNumber, setPhoneNumber] = useState(currentUser.phoneNumber || "")
  const [jobDescription, setJobDescription] = useState(currentUser.jobDescription || "")
  const [hireDate, setHireDate] = useState(
    currentUser.hireDate ? new Date(currentUser.hireDate).toISOString().split("T")[0] : ""
  )

  // Search state
  const [searchQuery, setSearchQuery] = useState("")
  const [searchMessages, setSearchMessages] = useState(true)
  const [searchUsers, setSearchUsers] = useState(false)
  const [searchTags, setSearchTags] = useState(false)
  const [searchResults, setSearchResults] = useState<{
    messages: Array<{ id: string; body: string; createdAt: string; conversationId: string }>
    users: Array<{ id: string; name: string; email: string }>
    tags: Array<{ consultationCaseId: string; category: string }>
  } | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchMessage, setSearchMessage] = useState<string | null>(null)

  // Export state
  const [exportType, setExportType] = useState<string>("conversations")
  const [isExporting, setIsExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (avatarPreview && avatarPreview !== currentUser.avatarUrl) {
        URL.revokeObjectURL(avatarPreview)
      }
    }
  }, [avatarPreview, currentUser.avatarUrl])

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

    // ファイルサイズチェック (4MB)
    if (file.size > 4 * 1024 * 1024) {
      setProfileMessage("画像ファイルは4MB以内にしてください。")
      return
    }

    setAvatarFile(file)
    setAvatarName(file.name)
    setAvatarPreview((prev) => {
      if (prev && prev !== currentUser.avatarUrl) {
        URL.revokeObjectURL(prev)
      }
      return URL.createObjectURL(file)
    })
  }

  async function handleProfileSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsProfileSaving(true)
    setProfileMessage(null)

    try {
      // プロフィール更新
      const updateData: Record<string, unknown> = {}

      if (displayName.trim() !== currentUser.name) {
        updateData.name = displayName.trim()
      }

      if (countryOfOrigin.trim() !== (currentUser.countryOfOrigin || "")) {
        updateData.countryOfOrigin = countryOfOrigin.trim() || null
      }

      if (dateOfBirth !== (currentUser.dateOfBirth ? new Date(currentUser.dateOfBirth).toISOString().split("T")[0] : "")) {
        updateData.dateOfBirth = dateOfBirth || null
      }

      if (gender.trim() !== (currentUser.gender || "")) {
        updateData.gender = gender.trim() || null
      }

      if (address.trim() !== (currentUser.address || "")) {
        updateData.address = address.trim() || null
      }

      if (phoneNumber.trim() !== (currentUser.phoneNumber || "")) {
        updateData.phoneNumber = phoneNumber.trim() || null
      }

      if (jobDescription.trim() !== (currentUser.jobDescription || "")) {
        updateData.jobDescription = jobDescription.trim() || null
      }

      if (hireDate !== (currentUser.hireDate ? new Date(currentUser.hireDate).toISOString().split("T")[0] : "")) {
        updateData.hireDate = hireDate || null
      }

      // アバター画像がアップロードされた場合
      // TODO: 実際のファイルアップロード処理（S3など）を実装する必要があります
      // 現時点では、ファイルが選択された場合はプレビューURLのみ表示
      if (avatarFile) {
        // 本番環境では、ここでファイルをアップロードし、そのURLを取得します
        // updateData.avatarUrl = await uploadAvatar(avatarFile)
        setProfileMessage("アバター画像のアップロードは現在準備中です。その他の情報は保存されました。")
      }

      if (Object.keys(updateData).length === 0) {
        setProfileMessage("変更がありません。")
        setIsProfileSaving(false)
        return
      }

      const response = await fetch(`/api/users/${currentUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "プロフィールの保存に失敗しました。")
      }

      await response.json()
      setProfileMessage(avatarFile ? profileMessage : "プロフィールを保存しました。")

      // ページをリロードして最新の情報を反映
      if (!avatarFile) {
        setTimeout(() => {
          window.location.reload()
        }, 1000)
      }
    } catch (error) {
      console.error("Failed to save profile:", error)
      setProfileMessage(error instanceof Error ? error.message : "プロフィールの保存に失敗しました。")
    } finally {
      setIsProfileSaving(false)
    }
  }

  async function handlePreferenceSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsPreferenceSaving(true)
    setPreferenceMessage(null)

    try {
      if (language === currentUser.locale) {
        setPreferenceMessage("変更がありません。")
        setIsPreferenceSaving(false)
        return
      }

      const response = await fetch(`/api/users/${currentUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: language }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "言語設定の保存に失敗しました。")
      }

      // localStorageにも保存
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
      }

      setPreferenceMessage("言語設定を保存しました。")

      // ページをリロードして最新の情報を反映
      setTimeout(() => {
        window.location.reload()
      }, 1000)
    } catch (error) {
      console.error("Failed to save language preference:", error)
      setPreferenceMessage(error instanceof Error ? error.message : "言語設定の保存に失敗しました。")
    } finally {
      setIsPreferenceSaving(false)
    }
  }

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!searchQuery.trim()) {
      setSearchMessage("検索キーワードを入力してください。")
      return
    }

    setIsSearching(true)
    setSearchMessage(null)
    setSearchResults(null)

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery.trim(),
          searchMessages,
          searchUsers,
          searchTags,
          limit: 50,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "検索に失敗しました。")
      }

      const data = await response.json()
      setSearchResults(data)
      setSearchMessage(
        `検索結果: メッセージ ${data.messages.length}件、ユーザー ${data.users.length}件、タグ ${data.tags.length}件`,
      )
    } catch (error) {
      console.error("Failed to search:", error)
      setSearchMessage(error instanceof Error ? error.message : "検索に失敗しました。")
    } finally {
      setIsSearching(false)
    }
  }

  async function handleExport() {
    setIsExporting(true)
    setExportMessage(null)

    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: exportType }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "エクスポートに失敗しました。")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${exportType}_${new Date().toISOString().split("T")[0]}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      setExportMessage("エクスポートが完了しました。")
    } catch (error) {
      console.error("Failed to export:", error)
      setExportMessage(error instanceof Error ? error.message : "エクスポートに失敗しました。")
    } finally {
      setIsExporting(false)
    }
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

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="country-of-origin">出身国</Label>
                  <Input
                    id="country-of-origin"
                    value={countryOfOrigin}
                    onChange={(event) => setCountryOfOrigin(event.target.value)}
                    placeholder="ベトナム"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="date-of-birth">生年月日</Label>
                  <Input
                    id="date-of-birth"
                    type="date"
                    value={dateOfBirth}
                    onChange={(event) => setDateOfBirth(event.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="gender">性別</Label>
                  <Input
                    id="gender"
                    value={gender}
                    onChange={(event) => setGender(event.target.value)}
                    placeholder="男性"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone-number">電話番号</Label>
                  <Input
                    id="phone-number"
                    value={phoneNumber}
                    onChange={(event) => setPhoneNumber(event.target.value)}
                    placeholder="090-1234-5678"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">住所</Label>
                <Input
                  id="address"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="東京都渋谷区..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="job-description">業務内容</Label>
                <Input
                  id="job-description"
                  value={jobDescription}
                  onChange={(event) => setJobDescription(event.target.value)}
                  placeholder="製造ライン作業"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="hire-date">入社年月日</Label>
                <Input
                  id="hire-date"
                  type="date"
                  value={hireDate}
                  onChange={(event) => setHireDate(event.target.value)}
                />
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={isProfileSaving}>
                  {isProfileSaving ? "保存中..." : "プロフィールを保存"}
                </Button>
              </div>

              {profileMessage ? (
                <p className={`text-xs ${profileMessage.includes("失敗") || profileMessage.includes("準備中") ? "text-red-500" : "text-muted-foreground"}`}>
                  {profileMessage}
                </p>
              ) : null}
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
                <Button type="submit" disabled={isPreferenceSaving}>
                  {isPreferenceSaving ? "保存中..." : "言語設定を保存"}
                </Button>
              </div>
              {preferenceMessage ? (
                <p className={`text-xs ${preferenceMessage.includes("失敗") ? "text-red-500" : "text-muted-foreground"}`}>
                  {preferenceMessage}
                </p>
              ) : null}
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
          <Badge variant="secondary">{ROLE_LABELS[currentUser.role]}</Badge>
          <span>{ROLE_DESCRIPTIONS[currentUser.role]}</span>
        </CardContent>
      </Card>

      {(currentUser.role === UserRole.MANAGER ||
        currentUser.role === UserRole.AREA_MANAGER ||
        currentUser.role === UserRole.SYSTEM_ADMIN) && (
        <>
          <Card className="border-none bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">検索</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSearch} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="search-query">検索キーワード</Label>
                  <Input
                    id="search-query"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="メッセージ本文、ユーザー名、タグなどを検索"
                  />
                </div>

                <div className="space-y-2">
                  <Label>検索対象</Label>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={searchMessages}
                        onChange={(e) => setSearchMessages(e.target.checked)}
                      />
                      <span className="text-sm">メッセージ</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={searchUsers}
                        onChange={(e) => setSearchUsers(e.target.checked)}
                      />
                      <span className="text-sm">ユーザー</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={searchTags}
                        onChange={(e) => setSearchTags(e.target.checked)}
                      />
                      <span className="text-sm">タグ</span>
                    </label>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={isSearching}>
                    {isSearching ? "検索中..." : "検索"}
                  </Button>
                </div>

                {searchMessage && (
                  <p
                    className={`text-xs ${searchMessage.includes("失敗") ? "text-red-500" : "text-muted-foreground"}`}
                  >
                    {searchMessage}
                  </p>
                )}

                {searchResults && (
                  <div className="mt-4 space-y-4">
                    {searchResults.messages.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="font-semibold text-sm">メッセージ</h3>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {searchResults.messages.map((message) => (
                            <div key={message.id} className="border rounded p-3 text-sm">
                              <p className="text-muted-foreground text-xs mb-1">
                                {new Date(message.createdAt).toLocaleString("ja-JP")}
                              </p>
                              <p className="line-clamp-2">{message.body}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {searchResults.users.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="font-semibold text-sm">ユーザー</h3>
                        <div className="space-y-2">
                          {searchResults.users.map((user) => (
                            <div key={user.id} className="border rounded p-3 text-sm">
                              <p className="font-medium">{user.name}</p>
                              <p className="text-muted-foreground text-xs">{user.email}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {searchResults.tags.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="font-semibold text-sm">タグ</h3>
                        <div className="space-y-2">
                          {searchResults.tags.map((tag, idx) => (
                            <div key={idx} className="border rounded p-3 text-sm">
                              <p className="font-medium">{tag.category}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </form>
            </CardContent>
          </Card>

          <Card className="border-none bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">データエクスポート</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="export-type">エクスポート種別</Label>
                <select
                  id="export-type"
                  value={exportType}
                  onChange={(e) => setExportType(e.target.value)}
                  className="w-full rounded-md border bg-white p-2 text-sm"
                >
                  <option value="conversations">会話一覧</option>
                  <option value="messages">メッセージ詳細</option>
                  <option value="users">ユーザー一覧</option>
                  <option value="suggestion_logs">AI提案ログ</option>
                  <option value="tag_logs">タグ変更ログ</option>
                  <option value="audit_logs">監査ログ</option>
                </select>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleExport} disabled={isExporting}>
                  {isExporting ? "エクスポート中..." : "CSVダウンロード"}
                </Button>
              </div>

              {exportMessage && (
                <p
                  className={`text-xs ${exportMessage.includes("失敗") ? "text-red-500" : "text-muted-foreground"}`}
                >
                  {exportMessage}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

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
