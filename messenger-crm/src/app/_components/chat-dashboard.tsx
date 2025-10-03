"use client"

import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

import type { CasePriority, CaseStatus } from "@prisma/client"

type UserRole = "WORKER" | "MANAGER" | "AREA_MANAGER" | "SYSTEM_ADMIN"

type MessageItem = {
  id: string
  body: string
  language: string
  createdAt: string
  sender: {
    id: string
    name: string | null
    role: UserRole
  }
  llmArtifact?: {
    translation?: string | null
    translationLang?: string | null
    suggestions?: Array<{ content: string; tone?: string; language?: string }>
  } | null
}

type ConsultationCase = {
  id: string
  category: string
  summary: string | null
  description?: string | null
  status: CaseStatus
  priority: CasePriority
}

type ConversationSummary = {
  id: string
  subject: string | null
  status: string
  updatedAt: string
  group: {
    id: string
    name: string
  }
  worker?: {
    id: string
    name: string | null
  } | null
  lastMessage?: MessageItem | null
  consultation?: ConsultationCase | null
}

type ConversationDetail = {
  id: string
  subject: string | null
  status: string
  group: { id: string; name: string }
  worker: { id: string; name: string | null; locale: string | null }
  consultation: (ConsultationCase & { description?: string | null }) | null
}

type GroupOption = {
  id: string
  name: string
}

type WorkerOption = {
  id: string
  name: string | null
  email: string | null
  groupIds: string[]
}

type ChatDashboardProps = {
  initialConversations: ConversationSummary[]
  availableGroups: GroupOption[]
  availableWorkers: WorkerOption[]
  currentUser: {
    id: string
    role: UserRole
    name?: string | null
  }
}

const ROLE_LANGUAGE: Record<UserRole, string> = {
  WORKER: "vi",
  MANAGER: "ja",
  AREA_MANAGER: "ja",
  SYSTEM_ADMIN: "ja",
}

const CASE_STATUS_OPTIONS: Array<{ value: CaseStatus; label: string }> = [
  { value: "IN_PROGRESS", label: "対応中" },
  { value: "RESOLVED", label: "解決済み" },
  { value: "ESCALATED", label: "エスカレーション" },
  { value: "ON_HOLD", label: "保留" },
]

const CASE_PRIORITY_OPTIONS: Array<{ value: CasePriority; label: string }> = [
  { value: "HIGH", label: "高" },
  { value: "MEDIUM", label: "中" },
  { value: "LOW", label: "低" },
]

type ConsultationFormState = {
  category: string
  summary: string
  description: string
  status: CaseStatus
  priority: CasePriority
}

const EMPTY_FORM: ConsultationFormState = {
  category: "",
  summary: "",
  description: "",
  status: "IN_PROGRESS",
  priority: "MEDIUM",
}

export function ChatDashboard({
  initialConversations,
  availableGroups,
  availableWorkers,
  currentUser,
}: ChatDashboardProps) {
  const [conversations, setConversations] = useState(initialConversations)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    initialConversations[0]?.id ?? null,
  )
  const [selectedConversation, setSelectedConversation] = useState<ConversationDetail | null>(null)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [composer, setComposer] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const [consultation, setConsultation] = useState<ConsultationCase | null>(null)
  const [consultationForm, setConsultationForm] = useState<ConsultationFormState>(EMPTY_FORM)
  const [consultationSaving, setConsultationSaving] = useState(false)
  const [consultationError, setConsultationError] = useState<string | null>(null)
  const [consultationNotice, setConsultationNotice] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createGroupId, setCreateGroupId] = useState<string>(() => availableGroups[0]?.id ?? "")
  const [createWorkerId, setCreateWorkerId] = useState<string>(() => {
    if (currentUser.role === "WORKER") {
      return currentUser.id
    }
    return availableWorkers[0]?.id ?? ""
  })
  const [createSubject, setCreateSubject] = useState("")
  const [createMessage, setCreateMessage] = useState("")
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const defaultLanguage = ROLE_LANGUAGE[currentUser.role]

  useEffect(() => {
    setCreateGroupId((prev) => {
      if (prev && availableGroups.some((group) => group.id === prev)) {
        return prev
      }
      return availableGroups[0]?.id ?? ""
    })
  }, [availableGroups])

  useEffect(() => {
    if (currentUser.role === "WORKER") {
      setCreateWorkerId(currentUser.id)
      return
    }

    setCreateWorkerId((prev) => {
      if (
        prev &&
        availableWorkers.some(
          (worker) => worker.id === prev && (!createGroupId || worker.groupIds.includes(createGroupId)),
        )
      ) {
        return prev
      }
      const fallback = availableWorkers.find((worker) =>
        !createGroupId || worker.groupIds.length === 0 ? true : worker.groupIds.includes(createGroupId),
      )
      return fallback?.id ?? ""
    })
  }, [availableWorkers, createGroupId, currentUser.role, currentUser.id])

  const activeConversation = useMemo(() => {
    return conversations.find((conv) => conv.id === selectedConversationId) ?? null
  }, [conversations, selectedConversationId])

  const workerOptionsForGroup = useMemo(() => {
    if (currentUser.role === "WORKER") {
      return availableWorkers.filter((worker) => worker.id === currentUser.id)
    }
    return availableWorkers.filter((worker) =>
      !createGroupId || worker.groupIds.length === 0 ? true : worker.groupIds.includes(createGroupId),
    )
  }, [availableWorkers, createGroupId, currentUser.role, currentUser.id])

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([])
      setSelectedConversation(null)
      setConsultation(null)
      setConsultationForm(EMPTY_FORM)
      return
    }

    let cancelled = false
    async function loadConversation() {
      setLoadingMessages(true)
      setLoadingError(null)
      setConsultationNotice(null)
      try {
        const res = await fetch(`/api/conversations/${selectedConversationId}/messages`, {
          method: "GET",
          cache: "no-store",
        })
        if (!res.ok) {
          throw new Error("Failed to load conversation")
        }
        const data = await res.json()
        if (cancelled) return

        const { conversation } = data as {
          conversation: ConversationDetail & { messages: MessageItem[] }
        }

        setSelectedConversation({
          id: conversation.id,
          subject: conversation.subject,
          status: conversation.status,
          group: conversation.group,
          worker: conversation.worker,
          consultation: conversation.consultation,
        })
        setMessages(conversation.messages ?? [])
        setConsultation(conversation.consultation ?? null)
        setConsultationForm({
          category: conversation.consultation?.category ?? "",
          summary: conversation.consultation?.summary ?? "",
          description: conversation.consultation?.description ?? "",
          status: (conversation.consultation?.status ?? "IN_PROGRESS") as CaseStatus,
          priority: (conversation.consultation?.priority ?? "MEDIUM") as CasePriority,
        })

        setConversations((current) =>
          current.map((conv) =>
            conv.id === conversation.id
              ? {
                  ...conv,
                  status: conversation.status,
                  lastMessage: conv.lastMessage,
                  consultation: conversation.consultation,
                  updatedAt: conv.updatedAt,
                }
              : conv,
          ),
        )
      } catch (error) {
        console.error(error)
        if (!cancelled) {
          setLoadingError("メッセージを読み込めませんでした。")
          setMessages([])
          setConsultation(null)
          setConsultationForm(EMPTY_FORM)
        }
      } finally {
        if (!cancelled) {
          setLoadingMessages(false)
        }
      }
    }

    loadConversation()

    return () => {
      cancelled = true
    }
  }, [selectedConversationId])

  async function handleSendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedConversationId || !composer.trim()) {
      return
    }

    setSending(true)
    setSendError(null)
    try {
      const res = await fetch(`/api/conversations/${selectedConversationId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: composer.trim(),
          language: defaultLanguage,
        }),
      })

      if (!res.ok) {
        throw new Error("failed to send")
      }

      const data = (await res.json()) as { message: MessageItem }
      setMessages((current) => [...current, data.message])
      setComposer("")
      setConversations((current) =>
        current.map((conv) =>
          conv.id === selectedConversationId
            ? {
                ...conv,
                lastMessage: {
                  id: data.message.id,
                  body: data.message.body,
                  language: data.message.language,
                  createdAt: data.message.createdAt,
                  sender: data.message.sender,
                },
                updatedAt: data.message.createdAt,
              }
            : conv,
        ),
      )
    } catch (error) {
      console.error(error)
      setSendError("メッセージの送信に失敗しました。")
    } finally {
      setSending(false)
    }
  }

  const canCreateConversation = availableGroups.length > 0 && availableWorkers.length > 0
  const canEditConsultation = currentUser.role !== "WORKER"

  async function handleCreateConversation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!canCreateConversation) {
      setCreateError("会話を作成できるグループがありません。")
      return
    }

    const groupId = createGroupId || availableGroups[0]?.id
    const workerId = currentUser.role === "WORKER" ? currentUser.id : createWorkerId

    if (!groupId || !workerId) {
      setCreateError("グループまたは参加者を選択してください。")
      return
    }

    setCreating(true)
    setCreateError(null)

    try {
      const payload: {
        groupId: string
        workerId: string
        subject?: string
        initialMessage?: { body: string; language: string }
      } = {
        groupId,
        workerId,
      }

      if (createSubject.trim()) {
        payload.subject = createSubject.trim()
      }

      if (createMessage.trim()) {
        payload.initialMessage = {
          body: createMessage.trim(),
          language: defaultLanguage,
        }
      }

      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        throw new Error("failed to create conversation")
      }

      const data = (await res.json()) as {
        conversation: ConversationDetail & { messages: MessageItem[] }
        summary: ConversationSummary
      }

      const normalizedSummary: ConversationSummary = {
        id: data.summary.id,
        subject: data.summary.subject,
        status: data.summary.status,
        updatedAt:
          typeof data.summary.updatedAt === "string"
            ? data.summary.updatedAt
            : new Date(data.summary.updatedAt).toISOString(),
        group: data.summary.group,
        worker: data.summary.worker,
        lastMessage: data.summary.lastMessage
          ? {
              ...data.summary.lastMessage,
              createdAt:
                typeof data.summary.lastMessage.createdAt === "string"
                  ? data.summary.lastMessage.createdAt
                  : new Date(data.summary.lastMessage.createdAt).toISOString(),
            }
          : null,
        consultation: data.summary.consultation ?? null,
      }

      setConversations((current) => [normalizedSummary, ...current.filter((conv) => conv.id !== normalizedSummary.id)])
      setSelectedConversationId(data.conversation.id)
      setSelectedConversation({
        id: data.conversation.id,
        subject: data.conversation.subject,
        status: data.conversation.status,
        group: data.conversation.group,
        worker: data.conversation.worker,
        consultation: data.conversation.consultation,
      })
      setMessages(data.conversation.messages ?? [])
      setConsultation(data.conversation.consultation ?? null)
      setConsultationForm({
        category: data.conversation.consultation?.category ?? "",
        summary: data.conversation.consultation?.summary ?? "",
        description: data.conversation.consultation?.description ?? "",
        status: (data.conversation.consultation?.status ?? "IN_PROGRESS") as CaseStatus,
        priority: (data.conversation.consultation?.priority ?? "MEDIUM") as CasePriority,
      })
      setCreateSubject("")
      setCreateMessage("")
      setCreateOpen(false)
    } catch (error) {
      console.error(error)
      setCreateError("相談の作成に失敗しました。")
    } finally {
      setCreating(false)
    }
  }

  async function handleConsultationSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setConsultationError(null)
    setConsultationNotice(null)

    if (!selectedConversationId) {
      setConsultationError("相談を選択してください。")
      return
    }

    if (!consultationForm.category.trim()) {
      setConsultationError("カテゴリは必須です。")
      return
    }

    setConsultationSaving(true)
    try {
      const res = await fetch(`/api/consultations/${selectedConversationId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: consultationForm.category.trim(),
          summary: consultationForm.summary.trim() || null,
          description: consultationForm.description.trim() || null,
          status: consultationForm.status,
          priority: consultationForm.priority,
        }),
      })

      if (!res.ok) {
        throw new Error("failed to update consultation")
      }

      const data = (await res.json()) as { consultation: ConsultationCase & { description?: string | null } }

      setConsultation(data.consultation)
      setConsultationNotice("相談記録を更新しました。")
      setConversations((current) =>
        current.map((conv) =>
          conv.id === selectedConversationId
            ? {
                ...conv,
                consultation: data.consultation,
              }
            : conv,
        ),
      )
    } catch (error) {
      console.error(error)
      setConsultationError("相談記録の更新に失敗しました。")
    } finally {
      setConsultationSaving(false)
    }
  }

  return (
    <div className="grid h-full min-h-[calc(100vh-5rem)] gap-4 p-4 lg:grid-cols-[320px_1fr]">
      <Card className="h-full overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold">会話一覧</CardTitle>
            {canCreateConversation ? (
              <Button size="sm" variant="outline" onClick={() => setCreateOpen((prev) => !prev)}>
                {createOpen ? "閉じる" : "新規相談"}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 overflow-y-auto">
          {createOpen ? (
            <form onSubmit={handleCreateConversation} className="space-y-3 rounded-md border bg-muted/30 p-3">
              <div className="space-y-1">
                <Label htmlFor="create-group">グループ</Label>
                <select
                  id="create-group"
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  value={createGroupId}
                  onChange={(event) => setCreateGroupId(event.target.value)}
                  disabled={currentUser.role === "WORKER"}
                >
                  {availableGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>

              {currentUser.role !== "WORKER" ? (
                <div className="space-y-1">
                  <Label htmlFor="create-worker">担当ユーザー</Label>
                  <select
                    id="create-worker"
                    className="w-full rounded-md border bg-background p-2 text-sm"
                    value={createWorkerId}
                    onChange={(event) => setCreateWorkerId(event.target.value)}
                  >
                    {workerOptionsForGroup.map((worker) => (
                      <option key={worker.id} value={worker.id}>
                        {worker.name ?? worker.email ?? "利用者"}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="space-y-1">
                <Label htmlFor="create-subject">件名 (任意)</Label>
                <Input
                  id="create-subject"
                  value={createSubject}
                  onChange={(event) => setCreateSubject(event.target.value)}
                  placeholder="相談の概要を入力"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="create-message">最初のメッセージ (任意)</Label>
                <Textarea
                  id="create-message"
                  rows={3}
                  value={createMessage}
                  onChange={(event) => setCreateMessage(event.target.value)}
                  placeholder="最初のメッセージを入力"
                />
                <p className="text-[10px] text-muted-foreground">送信言語: {defaultLanguage}</p>
              </div>

              {createError ? <p className="text-xs text-destructive">{createError}</p> : null}

              <Button type="submit" className="w-full" disabled={creating}>
                {creating ? "作成中..." : "相談を作成"}
              </Button>
            </form>
          ) : null}

          {conversations.length === 0 ? (
            <p className="text-sm text-muted-foreground">表示できる会話がありません。</p>
          ) : (
            <ul className="space-y-2">
              {conversations.map((conversation) => {
                const isActive = conversation.id === selectedConversationId
                const lastMessage = conversation.lastMessage
                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedConversationId(conversation.id)}
                      className={`w-full rounded-md border p-3 text-left transition hover:border-primary ${isActive ? "border-primary bg-primary/5" : "border-border"}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">
                          {conversation.subject || conversation.worker?.name || "相談"}
                        </span>
                        <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                          {conversation.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {lastMessage ? lastMessage.body.slice(0, 60) : "最新メッセージなし"}
                      </p>
                      {conversation.consultation ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          カテゴリ: {conversation.consultation.category} ／ 優先度: {conversation.consultation.priority}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        更新: {new Date(conversation.updatedAt).toLocaleString()}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="flex h-full flex-col">
        <CardHeader className="space-y-1">
          <CardTitle className="text-lg font-semibold">
            {activeConversation?.subject || activeConversation?.worker?.name || "会話を選択してください"}
          </CardTitle>
          {selectedConversation ? (
            <p className="text-xs text-muted-foreground">
              グループ: {selectedConversation.group.name} ／ ステータス: {selectedConversation.status}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto rounded-md border bg-muted/30 p-4">
            {loadingMessages ? (
              <p className="text-sm text-muted-foreground">読み込み中...</p>
            ) : loadingError ? (
              <p className="text-sm text-destructive">{loadingError}</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">メッセージがまだありません。</p>
            ) : (
              <ul className="space-y-4">
                {messages.map((message) => (
                  <li key={message.id} className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-semibold">{message.sender.name ?? "利用者"}</span>
                      <Separator orientation="vertical" className="h-3" />
                      <span>{new Date(message.createdAt).toLocaleString()}</span>
                      <Separator orientation="vertical" className="h-3" />
                      <span>{message.language}</span>
                    </div>
                    <div className="rounded-md bg-background p-3 shadow-sm">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>
                      {message.llmArtifact?.translation ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          翻訳: {message.llmArtifact.translation}
                        </p>
                      ) : null}
                      {message.llmArtifact?.suggestions?.length ? (
                        <div className="mt-3 space-y-1">
                          <p className="text-xs font-semibold text-muted-foreground">提案:</p>
                          <ul className="space-y-1">
                            {message.llmArtifact.suggestions.map((suggestion, index) => (
                              <li key={index} className="rounded-md bg-muted p-2 text-xs">
                                {suggestion.tone ? `[${suggestion.tone}] ` : null}
                                {suggestion.content}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={handleSendMessage} className="mt-4 space-y-3">
            <Textarea
              placeholder="メッセージを入力してください"
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              disabled={!selectedConversationId || sending}
              rows={3}
            />
            {sendError ? <p className="text-sm text-destructive">{sendError}</p> : null}
            <div className="flex items-center justify-between">
              <Input
                value={defaultLanguage}
                readOnly
                className="w-24 text-center text-xs"
                title="送信言語"
              />
              <Button type="submit" disabled={sending || !composer.trim() || !selectedConversationId}>
                {sending ? "送信中..." : "送信"}
              </Button>
            </div>
          </form>

          <Separator className="my-4" />

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">相談記録</h2>
              {!canEditConsultation ? (
                <span className="text-xs text-muted-foreground">閲覧のみ</span>
              ) : null}
            </div>

            {consultationNotice ? (
              <p className="mb-2 text-xs text-emerald-600">{consultationNotice}</p>
            ) : null}
            {consultationError ? (
              <p className="mb-2 text-xs text-destructive">{consultationError}</p>
            ) : null}

            {canEditConsultation ? (
              <form onSubmit={handleConsultationSubmit} className="space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="consultation-category">カテゴリ</Label>
                    <Input
                      id="consultation-category"
                      value={consultationForm.category}
                      onChange={(event) =>
                        setConsultationForm((prev) => ({ ...prev, category: event.target.value }))
                      }
                      placeholder="例: 住居問題"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="consultation-priority">優先度</Label>
                    <select
                      id="consultation-priority"
                      className="w-full rounded-md border bg-background p-2 text-sm"
                      value={consultationForm.priority}
                      onChange={(event) =>
                        setConsultationForm((prev) => ({
                          ...prev,
                          priority: event.target.value as CasePriority,
                        }))
                      }
                    >
                      {CASE_PRIORITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="consultation-status">ステータス</Label>
                    <select
                      id="consultation-status"
                      className="w-full rounded-md border bg-background p-2 text-sm"
                      value={consultationForm.status}
                      onChange={(event) =>
                        setConsultationForm((prev) => ({
                          ...prev,
                          status: event.target.value as CaseStatus,
                        }))
                      }
                    >
                      {CASE_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="consultation-summary">概要 (任意)</Label>
                    <Input
                      id="consultation-summary"
                      value={consultationForm.summary}
                      onChange={(event) =>
                        setConsultationForm((prev) => ({ ...prev, summary: event.target.value }))
                      }
                      placeholder="概要メモ"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="consultation-description">詳細メモ (任意)</Label>
                  <Textarea
                    id="consultation-description"
                    rows={3}
                    value={consultationForm.description}
                    onChange={(event) =>
                      setConsultationForm((prev) => ({ ...prev, description: event.target.value }))
                    }
                    placeholder="共有したい詳細や次のアクションを記入"
                  />
                </div>
                <Button type="submit" disabled={consultationSaving}>
                  {consultationSaving ? "保存中..." : "相談記録を保存"}
                </Button>
              </form>
            ) : consultation ? (
              <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
                <p>
                  <span className="font-semibold">カテゴリ:</span> {consultation.category}
                </p>
                <p>
                  <span className="font-semibold">優先度:</span> {consultation.priority}
                </p>
                <p>
                  <span className="font-semibold">ステータス:</span> {consultation.status}
                </p>
                {consultation.summary ? (
                  <p>
                    <span className="font-semibold">概要:</span> {consultation.summary}
                  </p>
                ) : null}
                {consultation.description ? (
                  <p className="whitespace-pre-wrap">
                    <span className="font-semibold">詳細:</span> {consultation.description}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">相談記録はまだ登録されていません。</p>
            )}
          </section>
        </CardContent>
      </Card>
    </div>
  )
}
