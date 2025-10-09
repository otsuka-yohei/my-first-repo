"use client"

import { useEffect, useState } from "react"
import { UserRole } from "@prisma/client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

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
  WORKER: "ワーカー",
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
  const [createRole, setCreateRole] = useState<UserRole>(UserRole.WORKER)
  const [createGroupIds, setCreateGroupIds] = useState<string[]>([])
  const [createMessage, setCreateMessage] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  // グループ変更フォーム
  const [updateUserId, setUpdateUserId] = useState<string>("")
  const [updateGroupIds, setUpdateGroupIds] = useState<string[]>([])
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)

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

      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: createEmail.trim(),
          password: createPassword,
          name: createName.trim(),
          role: createRole,
          groupIds: createGroupIds,
          locale: "ja",
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "ユーザーの作成に失敗しました。")
      }

      setCreateMessage("ユーザーを作成しました。")
      setCreateName("")
      setCreateEmail("")
      setCreatePassword("")
      setCreateRole(UserRole.WORKER)
      setCreateGroupIds(groups.length > 0 ? [groups[0].id] : [])

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
                <option value={UserRole.WORKER}>{ROLE_LABELS[UserRole.WORKER]}</option>
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
