"use client"

import { useEffect, useState } from "react"
import { UserRole } from "@prisma/client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface Group {
  id: string
  name: string
}

interface UserWithGroups {
  id: string
  name: string
  email: string
  role: UserRole
  isActive: boolean
  memberships: Array<{
    group: Group
  }>
}

interface CurrentUser {
  id: string
  role: UserRole
}

interface UsersClientProps {
  currentUser: CurrentUser
}

const ROLE_LABELS: Record<UserRole, string> = {
  MEMBER: "メンバー",
  MANAGER: "マネージャー",
  AREA_MANAGER: "エリアマネージャー",
  SYSTEM_ADMIN: "システム管理者",
}

export default function UsersClient({ currentUser }: UsersClientProps) {
  const [users, setUsers] = useState<UserWithGroups[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)

  // ユーザー登録フォーム
  const [createName, setCreateName] = useState("")
  const [createEmail, setCreateEmail] = useState("")
  const [createPassword, setCreatePassword] = useState("")
  const [createRole, setCreateRole] = useState<UserRole>(UserRole.MEMBER)
  const [createGroupIds, setCreateGroupIds] = useState<string[]>([])
  const [createMessage, setCreateMessage] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  // 任意フィールド（ワーカーのみ）
  const [createCountryOfOrigin, setCreateCountryOfOrigin] = useState("")
  const [createDateOfBirth, setCreateDateOfBirth] = useState("")
  const [createGender, setCreateGender] = useState("")
  const [createAddress, setCreateAddress] = useState("")
  const [createPhoneNumber, setCreatePhoneNumber] = useState("")
  const [createJobDescription, setCreateJobDescription] = useState("")
  const [createHireDate, setCreateHireDate] = useState("")
  const [createNotes, setCreateNotes] = useState("")

  // グループ変更フォーム
  const [updateUserId, setUpdateUserId] = useState<string>("")
  const [updateGroupIds, setUpdateGroupIds] = useState<string[]>([])
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)

  // CSVインポート
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvMessage, setCsvMessage] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (!createMessage) return
    const timer = window.setTimeout(() => setCreateMessage(null), 5000)
    return () => window.clearTimeout(timer)
  }, [createMessage])

  useEffect(() => {
    if (!updateMessage) return
    const timer = window.setTimeout(() => setUpdateMessage(null), 5000)
    return () => window.clearTimeout(timer)
  }, [updateMessage])

  useEffect(() => {
    if (!csvMessage) return
    const timer = window.setTimeout(() => setCsvMessage(null), 5000)
    return () => window.clearTimeout(timer)
  }, [csvMessage])

  async function loadData() {
    setLoading(true)
    try {
      const [usersRes, groupsRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/groups"),
      ])

      if (usersRes.ok) {
        const usersData = await usersRes.json()
        setUsers(usersData.users || [])
      }

      if (groupsRes.ok) {
        const groupsData = await groupsRes.json()
        setGroups(groupsData.groups || [])
        if (groupsData.groups?.length > 0) {
          setCreateGroupIds([groupsData.groups[0].id])
          setUpdateGroupIds([groupsData.groups[0].id])
        }
      }
    } catch (error) {
      console.error("Failed to load data:", error)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsCreating(true)
    setCreateMessage(null)

    try {
      if (!createName.trim() || !createEmail.trim() || !createPassword.trim()) {
        setCreateMessage("すべてのフィールドを入力してください。")
        setIsCreating(false)
        return
      }

      if (createGroupIds.length === 0) {
        setCreateMessage("少なくとも1つのグループを選択してください。")
        setIsCreating(false)
        return
      }

      const payload: Record<string, unknown> = {
        email: createEmail.trim(),
        password: createPassword,
        name: createName.trim(),
        role: createRole,
        groupIds: createGroupIds,
        locale: "ja",
      }

      // ワーカーの場合のみ任意フィールドを追加
      if (createRole === UserRole.MEMBER) {
        if (createCountryOfOrigin.trim()) payload.countryOfOrigin = createCountryOfOrigin.trim()
        if (createDateOfBirth) payload.dateOfBirth = createDateOfBirth
        if (createGender.trim()) payload.gender = createGender.trim()
        if (createAddress.trim()) payload.address = createAddress.trim()
        if (createPhoneNumber.trim()) payload.phoneNumber = createPhoneNumber.trim()
        if (createJobDescription.trim()) payload.jobDescription = createJobDescription.trim()
        if (createHireDate) payload.hireDate = createHireDate
        if (createNotes.trim()) payload.notes = createNotes.trim()
      }

      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "ユーザーの作成に失敗しました。")
      }

      setCreateMessage("ユーザーを作成しました。")
      setCreateName("")
      setCreateEmail("")
      setCreatePassword("")
      setCreateRole(UserRole.MEMBER)
      setCreateGroupIds(groups.length > 0 ? [groups[0].id] : [])
      setCreateCountryOfOrigin("")
      setCreateDateOfBirth("")
      setCreateGender("")
      setCreateAddress("")
      setCreatePhoneNumber("")
      setCreateJobDescription("")
      setCreateHireDate("")
      setCreateNotes("")

      // ユーザー一覧を再読み込み
      await loadData()
    } catch (error) {
      console.error("Failed to create user:", error)
      setCreateMessage(error instanceof Error ? error.message : "ユーザーの作成に失敗しました。")
    } finally {
      setIsCreating(false)
    }
  }

  async function handleUpdateUserGroups(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsUpdating(true)
    setUpdateMessage(null)

    try {
      if (!updateUserId) {
        setUpdateMessage("ユーザーを選択してください。")
        setIsUpdating(false)
        return
      }

      if (updateGroupIds.length === 0) {
        setUpdateMessage("少なくとも1つのグループを選択してください。")
        setIsUpdating(false)
        return
      }

      const response = await fetch(`/api/users/${updateUserId}/groups`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupIds: updateGroupIds }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "グループの変更に失敗しました。")
      }

      setUpdateMessage("グループを変更しました。")

      // ユーザー一覧を再読み込み
      await loadData()
    } catch (error) {
      console.error("Failed to update user groups:", error)
      setUpdateMessage(error instanceof Error ? error.message : "グループの変更に失敗しました。")
    } finally {
      setIsUpdating(false)
    }
  }

  async function toggleUserStatus(userId: string, currentStatus: boolean) {
    try {
      const response = await fetch(`/api/users/${userId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !currentStatus }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "ステータスの変更に失敗しました。")
      }

      await loadData()
    } catch (error) {
      console.error("Failed to toggle user status:", error)
      alert(error instanceof Error ? error.message : "ステータスの変更に失敗しました。")
    }
  }

  function handleGroupSelection(groupId: string, selected: boolean, isCreate: boolean) {
    if (isCreate) {
      setCreateGroupIds((prev) =>
        selected ? [...prev, groupId] : prev.filter((id) => id !== groupId)
      )
    } else {
      setUpdateGroupIds((prev) =>
        selected ? [...prev, groupId] : prev.filter((id) => id !== groupId)
      )
    }
  }

  function handleDownloadTemplate() {
    const headers = [
      "名前*",
      "メールアドレス*",
      "パスワード*",
      "ロール*",
      "グループID*",
      "出身国",
      "生年月日",
      "性別",
      "住所",
      "電話番号",
      "業務内容",
      "入社年月日",
      "備考",
    ]
    const exampleRow = [
      "山田太郎",
      "yamada@example.com",
      "password123",
      "MEMBER",
      groups.length > 0 ? groups[0].id : "group-id-here",
      "ベトナム",
      "1990-01-01",
      "男性",
      "東京都渋谷区...",
      "090-1234-5678",
      "製造ライン作業",
      "2024-01-01",
      "個別面談の内容など",
    ]

    const csvContent = [headers.join(","), exampleRow.join(",")].join("\n")
    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "user_import_template.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  async function handleCsvImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!csvFile) {
      setCsvMessage("CSVファイルを選択してください。")
      return
    }

    setIsImporting(true)
    setCsvMessage(null)

    try {
      const text = await csvFile.text()
      const lines = text.split("\n").filter((line) => line.trim())

      if (lines.length < 2) {
        throw new Error("CSVファイルにデータがありません。")
      }

      const _headers = lines[0].split(",").map((h) => h.trim())
      const rows = lines.slice(1)

      let successCount = 0
      let errorCount = 0
      const errors: string[] = []

      for (let i = 0; i < rows.length; i++) {
        const values = rows[i].split(",").map((v) => v.trim())

        if (values.length < 5) {
          errors.push(`行${i + 2}: 必須フィールドが不足しています`)
          errorCount++
          continue
        }

        const [name, email, password, role, groupId, ...optionalFields] = values

        try {
          const payload: Record<string, unknown> = {
            name,
            email,
            password,
            role,
            groupIds: [groupId],
            locale: "ja",
          }

          // ワーカーの場合のみ任意フィールドを追加
          if (role === "MEMBER") {
            if (optionalFields[0]) payload.countryOfOrigin = optionalFields[0]
            if (optionalFields[1]) payload.dateOfBirth = optionalFields[1]
            if (optionalFields[2]) payload.gender = optionalFields[2]
            if (optionalFields[3]) payload.address = optionalFields[3]
            if (optionalFields[4]) payload.phoneNumber = optionalFields[4]
            if (optionalFields[5]) payload.jobDescription = optionalFields[5]
            if (optionalFields[6]) payload.hireDate = optionalFields[6]
            if (optionalFields[7]) payload.notes = optionalFields[7]
          }

          const response = await fetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })

          if (response.ok) {
            successCount++
          } else {
            const errorData = await response.json()
            errors.push(`行${i + 2} (${email}): ${errorData.error}`)
            errorCount++
          }
        } catch (error) {
          errors.push(`行${i + 2} (${email}): ${error instanceof Error ? error.message : "不明なエラー"}`)
          errorCount++
        }
      }

      setCsvMessage(
        `インポート完了: 成功 ${successCount}件, 失敗 ${errorCount}件${errors.length > 0 ? `\n最初のエラー: ${errors[0]}` : ""}`
      )
      setCsvFile(null)
      await loadData()
    } catch (error) {
      console.error("Failed to import CSV:", error)
      setCsvMessage(error instanceof Error ? error.message : "CSVインポートに失敗しました。")
    } finally {
      setIsImporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">読み込み中...</p>
      </div>
    )
  }

  return (
    <div className="space-y-8 bg-muted/20 p-10">
      <section className="rounded-2xl border bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">CSVインポート</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          CSVファイルから複数のユーザーを一括登録できます。
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button onClick={handleDownloadTemplate} variant="outline">
            テンプレートをダウンロード
          </Button>
          <form onSubmit={handleCsvImport} className="flex flex-1 items-center gap-3">
            <Input
              type="file"
              accept=".csv"
              onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
              className="max-w-xs"
              disabled={isImporting}
            />
            <Button type="submit" disabled={isImporting || !csvFile}>
              {isImporting ? "インポート中..." : "インポート"}
            </Button>
          </form>
        </div>
        {csvMessage && (
          <p
            className={`mt-4 whitespace-pre-line text-xs ${csvMessage.includes("失敗") || csvMessage.includes("してください") ? "text-red-500" : "text-green-600"}`}
          >
            {csvMessage}
          </p>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">ユーザー一覧</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          マネージャー以上のロールでは、所属グループのユーザー情報を更新できます。
        </p>
        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-3">名前</th>
                <th className="py-3">メール</th>
                <th className="py-3">ロール</th>
                <th className="py-3">所属グループ</th>
                <th className="py-3">ステータス</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    ユーザーが見つかりません
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="border-b">
                    <td className="py-3 font-medium">{user.name}</td>
                    <td className="py-3">{user.email}</td>
                    <td className="py-3">{ROLE_LABELS[user.role]}</td>
                    <td className="py-3">
                      {user.memberships.map((m) => m.group.name).join(", ") || "なし"}
                    </td>
                    <td className="py-3">
                      <Button
                        size="sm"
                        variant={user.isActive ? "default" : "outline"}
                        onClick={() => toggleUserStatus(user.id, user.isActive)}
                        disabled={user.id === currentUser.id}
                      >
                        {user.isActive ? "有効" : "無効"}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">ユーザーを登録</h2>
          <form onSubmit={handleCreateUser} className="mt-4 space-y-3">
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="create-name">
                名前
              </label>
              <Input
                id="create-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="山田 太郎"
                className="mt-1"
                disabled={isCreating}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="create-email">
                メールアドレス
              </label>
              <Input
                id="create-email"
                type="email"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                placeholder="user@example.com"
                className="mt-1"
                disabled={isCreating}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="create-password">
                パスワード（8文字以上）
              </label>
              <Input
                id="create-password"
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1"
                disabled={isCreating}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="create-role">
                ロール
              </label>
              <select
                id="create-role"
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value as UserRole)}
                className="mt-1 w-full rounded-md border bg-white p-2 text-sm"
                disabled={isCreating}
              >
                <option value={UserRole.MEMBER}>{ROLE_LABELS[UserRole.MEMBER]}</option>
                <option value={UserRole.MANAGER}>{ROLE_LABELS[UserRole.MANAGER]}</option>
                <option value={UserRole.AREA_MANAGER}>{ROLE_LABELS[UserRole.AREA_MANAGER]}</option>
                {currentUser.role === UserRole.SYSTEM_ADMIN && (
                  <option value={UserRole.SYSTEM_ADMIN}>{ROLE_LABELS[UserRole.SYSTEM_ADMIN]}</option>
                )}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">所属グループ</label>
              <div className="mt-2 space-y-2">
                {groups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">利用可能なグループがありません</p>
                ) : (
                  groups.map((group) => (
                    <label key={group.id} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={createGroupIds.includes(group.id)}
                        onChange={(e) => handleGroupSelection(group.id, e.target.checked, true)}
                        disabled={isCreating}
                        className="rounded"
                      />
                      <span className="text-sm">{group.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {createRole === UserRole.MEMBER && (
              <>
                <div className="border-t pt-3">
                  <p className="text-sm font-medium text-muted-foreground mb-3">任意情報（メンバーのみ）</p>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground" htmlFor="create-country">
                    出身国
                  </label>
                  <Input
                    id="create-country"
                    value={createCountryOfOrigin}
                    onChange={(e) => setCreateCountryOfOrigin(e.target.value)}
                    placeholder="ベトナム"
                    className="mt-1"
                    disabled={isCreating}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground" htmlFor="create-dob">
                    生年月日
                  </label>
                  <Input
                    id="create-dob"
                    type="date"
                    value={createDateOfBirth}
                    onChange={(e) => setCreateDateOfBirth(e.target.value)}
                    className="mt-1"
                    disabled={isCreating}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground" htmlFor="create-gender">
                    性別
                  </label>
                  <Input
                    id="create-gender"
                    value={createGender}
                    onChange={(e) => setCreateGender(e.target.value)}
                    placeholder="男性 / 女性 / その他"
                    className="mt-1"
                    disabled={isCreating}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground" htmlFor="create-address">
                    住所
                  </label>
                  <Input
                    id="create-address"
                    value={createAddress}
                    onChange={(e) => setCreateAddress(e.target.value)}
                    placeholder="東京都渋谷区..."
                    className="mt-1"
                    disabled={isCreating}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground" htmlFor="create-phone">
                    電話番号
                  </label>
                  <Input
                    id="create-phone"
                    value={createPhoneNumber}
                    onChange={(e) => setCreatePhoneNumber(e.target.value)}
                    placeholder="090-1234-5678"
                    className="mt-1"
                    disabled={isCreating}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground" htmlFor="create-job">
                    業務内容
                  </label>
                  <Input
                    id="create-job"
                    value={createJobDescription}
                    onChange={(e) => setCreateJobDescription(e.target.value)}
                    placeholder="製造ライン作業"
                    className="mt-1"
                    disabled={isCreating}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground" htmlFor="create-hire">
                    入社年月日
                  </label>
                  <Input
                    id="create-hire"
                    type="date"
                    value={createHireDate}
                    onChange={(e) => setCreateHireDate(e.target.value)}
                    className="mt-1"
                    disabled={isCreating}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground" htmlFor="create-notes">
                    備考
                  </label>
                  <Textarea
                    id="create-notes"
                    value={createNotes}
                    onChange={(e) => setCreateNotes(e.target.value)}
                    placeholder="個別面談の内容など..."
                    className="mt-1"
                    rows={3}
                    disabled={isCreating}
                  />
                </div>
              </>
            )}

            <Button type="submit" className="w-full" disabled={isCreating}>
              {isCreating ? "登録中..." : "登録"}
            </Button>
            {createMessage && (
              <p
                className={`text-xs ${createMessage.includes("失敗") || createMessage.includes("してください") ? "text-red-500" : "text-green-600"}`}
              >
                {createMessage}
              </p>
            )}
          </form>
        </div>

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">所属グループを変更</h2>
          <form onSubmit={handleUpdateUserGroups} className="mt-4 space-y-3">
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="update-user">
                対象ユーザー
              </label>
              <select
                id="update-user"
                value={updateUserId}
                onChange={(e) => {
                  const userId = e.target.value
                  setUpdateUserId(userId)
                  // 選択したユーザーの現在のグループを設定
                  const selectedUser = users.find((u) => u.id === userId)
                  if (selectedUser) {
                    setUpdateGroupIds(selectedUser.memberships.map((m) => m.group.id))
                  }
                }}
                className="mt-1 w-full rounded-md border bg-white p-2 text-sm"
                disabled={isUpdating}
              >
                <option value="">ユーザーを選択</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.email})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">新しいグループ</label>
              <div className="mt-2 space-y-2">
                {groups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">利用可能なグループがありません</p>
                ) : (
                  groups.map((group) => (
                    <label key={group.id} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={updateGroupIds.includes(group.id)}
                        onChange={(e) => handleGroupSelection(group.id, e.target.checked, false)}
                        disabled={isUpdating || !updateUserId}
                        className="rounded"
                      />
                      <span className="text-sm">{group.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={isUpdating || !updateUserId}>
              {isUpdating ? "変更中..." : "グループを変更"}
            </Button>
            {updateMessage && (
              <p
                className={`text-xs ${updateMessage.includes("失敗") || updateMessage.includes("してください") ? "text-red-500" : "text-green-600"}`}
              >
                {updateMessage}
              </p>
            )}
          </form>
        </div>
      </section>
    </div>
  )
}
