"use client"

import { useEffect, useState } from "react"
import { Plus, Pencil, Trash2, Users, MessageSquare, RotateCcw, ArrowRightLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface Group {
  id: string
  name: string
  description: string | null
  organization: {
    id: string
    name: string
  }
  _count: {
    memberships: number
    conversations: number
  }
  createdAt: string
  isDeleted: boolean
  deletedAt: string | null
  deletedBy: string | null
}

interface Organization {
  id: string
  name: string
  description: string | null
}

export default function GroupsClient() {
  const [activeGroups, setActiveGroups] = useState<Group[]>([])
  const [deletedGroups, setDeletedGroups] = useState<Group[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // モーダル状態
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isRestoreOpen, setIsRestoreOpen] = useState(false)
  const [isMigrateOpen, setIsMigrateOpen] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)

  // フォーム状態
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    organizationId: "",
  })
  const [migrateData, setMigrateData] = useState({
    toGroupId: "",
    migrateConversations: true,
    migrateMembers: true,
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError(null)

    try {
      const [activeRes, deletedRes, orgsRes] = await Promise.all([
        fetch("/api/groups"),
        fetch("/api/groups?includeDeleted=true"),
        fetch("/api/organizations"),
      ])

      if (!activeRes.ok) {
        throw new Error("グループの取得に失敗しました")
      }

      if (!deletedRes.ok) {
        throw new Error("削除済みグループの取得に失敗しました")
      }

      if (!orgsRes.ok) {
        throw new Error("組織の取得に失敗しました")
      }

      const activeData = await activeRes.json()
      const deletedData = await deletedRes.json()
      const orgsData = await orgsRes.json()

      const allGroups: Group[] = deletedData.groups
      setActiveGroups(allGroups.filter((g) => !g.isDeleted))
      setDeletedGroups(allGroups.filter((g) => g.isDeleted))
      setOrganizations(orgsData.organizations)
    } catch (err) {
      setError(err instanceof Error ? err.message : "データの読み込みに失敗しました")
    } finally {
      setLoading(false)
    }
  }

  function openCreateModal() {
    setFormData({ name: "", description: "", organizationId: "" })
    setFormError(null)
    setIsCreateOpen(true)
  }

  function openEditModal(group: Group) {
    setSelectedGroup(group)
    setFormData({
      name: group.name,
      description: group.description ?? "",
      organizationId: group.organization.id,
    })
    setFormError(null)
    setIsEditOpen(true)
  }

  function openDeleteModal(group: Group) {
    setSelectedGroup(group)
    setIsDeleteOpen(true)
  }

  function openRestoreModal(group: Group) {
    setSelectedGroup(group)
    setIsRestoreOpen(true)
  }

  function openMigrateModal(group: Group) {
    setSelectedGroup(group)
    setMigrateData({
      toGroupId: "",
      migrateConversations: true,
      migrateMembers: true,
    })
    setFormError(null)
    setIsMigrateOpen(true)
  }

  async function handleCreate() {
    if (!formData.name.trim()) {
      setFormError("グループ名は必須です")
      return
    }

    if (!formData.organizationId) {
      setFormError("組織を選択してください")
      return
    }

    setSubmitting(true)
    setFormError(null)

    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          organizationId: formData.organizationId,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || "グループの作成に失敗しました")
      }

      await loadData()
      setIsCreateOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "グループの作成に失敗しました")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleEdit() {
    if (!selectedGroup) return

    if (!formData.name.trim()) {
      setFormError("グループ名は必須です")
      return
    }

    setSubmitting(true)
    setFormError(null)

    try {
      const res = await fetch(`/api/groups/${selectedGroup.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || "グループの更新に失敗しました")
      }

      await loadData()
      setIsEditOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "グループの更新に失敗しました")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!selectedGroup) return

    setSubmitting(true)

    try {
      const res = await fetch(`/api/groups/${selectedGroup.id}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || "グループの削除に失敗しました")
      }

      await loadData()
      setIsDeleteOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "グループの削除に失敗しました")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRestore() {
    if (!selectedGroup) return

    setSubmitting(true)

    try {
      const res = await fetch(`/api/groups/${selectedGroup.id}`, {
        method: "PUT",
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || "グループの復元に失敗しました")
      }

      await loadData()
      setIsRestoreOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "グループの復元に失敗しました")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleMigrate() {
    if (!selectedGroup) return

    if (!migrateData.toGroupId) {
      setFormError("移行先のグループを選択してください")
      return
    }

    if (!migrateData.migrateConversations && !migrateData.migrateMembers) {
      setFormError("会話またはメンバーの少なくとも1つを選択してください")
      return
    }

    setSubmitting(true)
    setFormError(null)

    try {
      const res = await fetch(`/api/groups/${selectedGroup.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(migrateData),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || "データの移行に失敗しました")
      }

      await loadData()
      setIsMigrateOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "データの移行に失敗しました")
    } finally {
      setSubmitting(false)
    }
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return ""
    const date = new Date(dateString)
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">読み込み中...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">{error}</p>
          <Button onClick={loadData}>再読み込み</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">グループ管理</h1>
          <p className="mt-2 text-muted-foreground">組織内のグループを管理します</p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="mr-2 h-4 w-4" />
          新規グループ
        </Button>
      </div>

      <Tabs defaultValue="active" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="active">
            アクティブ ({activeGroups.length})
          </TabsTrigger>
          <TabsTrigger value="deleted">
            削除済み ({deletedGroups.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {activeGroups.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Users className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">グループがまだありません</p>
                <Button className="mt-4" onClick={openCreateModal}>
                  最初のグループを作成
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {activeGroups.map((group) => (
                <Card key={group.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg">{group.name}</CardTitle>
                        <CardDescription className="mt-1">{group.organization.name}</CardDescription>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditModal(group)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openMigrateModal(group)}
                          title="データ移行"
                        >
                          <ArrowRightLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openDeleteModal(group)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {group.description && (
                      <p className="mb-4 text-sm text-muted-foreground">{group.description}</p>
                    )}
                    <div className="flex gap-4 text-sm">
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span>{group._count.memberships} メンバー</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        <span>{group._count.conversations} 会話</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="deleted">
          {deletedGroups.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Trash2 className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">削除されたグループはありません</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {deletedGroups.map((group) => (
                <Card key={group.id} className="border-destructive/50 bg-destructive/5">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="mb-2 flex items-center gap-2">
                          <CardTitle className="text-lg">{group.name}</CardTitle>
                          <Badge variant="destructive" className="text-xs">
                            削除済み
                          </Badge>
                        </div>
                        <CardDescription className="mt-1">{group.organization.name}</CardDescription>
                        {group.deletedAt && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            削除日時: {formatDate(group.deletedAt)}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openRestoreModal(group)}
                          title="復元"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {group.description && (
                      <p className="mb-4 text-sm text-muted-foreground">{group.description}</p>
                    )}
                    <div className="flex gap-4 text-sm">
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span>{group._count.memberships} メンバー</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        <span>{group._count.conversations} 会話</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* 作成モーダル */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新規グループ作成</DialogTitle>
            <DialogDescription>新しいグループを作成します</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="org">組織</Label>
              <Select
                value={formData.organizationId}
                onValueChange={(value) => setFormData({ ...formData, organizationId: value })}
              >
                <SelectTrigger id="org">
                  <SelectValue placeholder="組織を選択" />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="name">グループ名</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="例: 東京支店"
              />
            </div>
            <div>
              <Label htmlFor="description">説明（任意）</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="グループの説明を入力"
                rows={3}
              />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={submitting}>
              キャンセル
            </Button>
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? "作成中..." : "作成"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 編集モーダル */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>グループ編集</DialogTitle>
            <DialogDescription>グループ情報を編集します</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-org">組織</Label>
              <Input id="edit-org" value={selectedGroup?.organization.name ?? ""} disabled />
            </div>
            <div>
              <Label htmlFor="edit-name">グループ名</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-description">説明（任意）</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)} disabled={submitting}>
              キャンセル
            </Button>
            <Button onClick={handleEdit} disabled={submitting}>
              {submitting ? "更新中..." : "更新"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 削除確認モーダル */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>グループを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedGroup && (
                <>
                  「{selectedGroup.name}」を削除します。
                  <span className="mt-2 block">
                    このグループには{selectedGroup._count.conversations}件の会話と
                    {selectedGroup._count.memberships}名のメンバーがいます。
                  </span>
                  <span className="mt-2 block font-semibold text-amber-600">
                    削除後も復元が可能です。データを完全に移行または削除する場合は、削除前に「データ移行」機能をご利用ください。
                  </span>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={submitting}>
              {submitting ? "削除中..." : "削除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 復元確認モーダル */}
      <AlertDialog open={isRestoreOpen} onOpenChange={setIsRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>グループを復元しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedGroup && (
                <>
                  「{selectedGroup.name}」を復元します。
                  <span className="mt-2 block">
                    このグループには{selectedGroup._count.conversations}件の会話と
                    {selectedGroup._count.memberships}名のメンバーがいます。
                  </span>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestore} disabled={submitting}>
              {submitting ? "復元中..." : "復元"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* データ移行モーダル */}
      <Dialog open={isMigrateOpen} onOpenChange={setIsMigrateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>グループデータ移行</DialogTitle>
            <DialogDescription>
              会話とメンバーを別のグループに移行します
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-semibold">⚠️ この操作は取り消せません</p>
              <p className="mt-1">
                選択したデータは「{selectedGroup?.name}」から移行先グループに移動されます。
              </p>
            </div>
            <div>
              <Label htmlFor="target-group">移行先グループ</Label>
              <Select
                value={migrateData.toGroupId}
                onValueChange={(value) => setMigrateData({ ...migrateData, toGroupId: value })}
              >
                <SelectTrigger id="target-group">
                  <SelectValue placeholder="グループを選択" />
                </SelectTrigger>
                <SelectContent>
                  {activeGroups
                    .filter((g) => g.id !== selectedGroup?.id)
                    .map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name} ({group.organization.name})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3">
              <Label>移行するデータ</Label>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="migrate-conversations"
                  checked={migrateData.migrateConversations}
                  onCheckedChange={(checked) =>
                    setMigrateData({ ...migrateData, migrateConversations: !!checked })
                  }
                />
                <label
                  htmlFor="migrate-conversations"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  会話 ({selectedGroup?._count.conversations ?? 0}件)
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="migrate-members"
                  checked={migrateData.migrateMembers}
                  onCheckedChange={(checked) =>
                    setMigrateData({ ...migrateData, migrateMembers: !!checked })
                  }
                />
                <label
                  htmlFor="migrate-members"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  メンバー ({selectedGroup?._count.memberships ?? 0}名)
                </label>
              </div>
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMigrateOpen(false)} disabled={submitting}>
              キャンセル
            </Button>
            <Button onClick={handleMigrate} disabled={submitting} variant="destructive">
              {submitting ? "移行中..." : "移行"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
