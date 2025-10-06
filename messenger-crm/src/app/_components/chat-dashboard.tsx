"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  BarChart3,
  Bot,
  LogOut,
  MessageSquare,
  Settings,
  Users,
} from "lucide-react"

const NAV_ITEMS = [
  { id: "chat", icon: MessageSquare, label: "相談" },
  { id: "members", icon: Users, label: "顧客" },
  { id: "reports", icon: BarChart3, label: "レポート" },
  { id: "settings", icon: Settings, label: "設定" },
]

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

import type { CasePriority } from "@prisma/client"

// Extend CaseStatus to include 'PENDING'
type CaseStatus = "IN_PROGRESS" | "RESOLVED" | "PENDING" | "CLOSED"

// CasePriority enum に対応する日本語ラベル
const CASE_PRIORITY_LABEL: Record<CasePriority, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
}

// CaseStatus enum に対応する日本語ラベル
const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  IN_PROGRESS: "対応中",
  RESOLVED: "解決済み",
  PENDING: "保留",
  CLOSED: "終了",
}

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

export function ChatDashboard(props: ChatDashboardProps) {
  if (props.currentUser.role === "WORKER") {
    return <WorkerChatDashboard {...props} />
  }

  return <ManagerChatDashboard {...props} />
}

// -------------------- Worker view --------------------

function WorkerChatDashboard({
  initialConversations,
  availableWorkers,
  currentUser,
}: ChatDashboardProps) {
  const managerOptions = useMemo(
    () => availableWorkers.filter((worker) => worker.id !== currentUser.id),
    [availableWorkers, currentUser.id],
  )
  const [conversationSummaries, setConversationSummaries] = useState(initialConversations)
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(null)
  const [selectedManager, setSelectedManager] = useState<WorkerOption | null>(null)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [conversationDetail, setConversationDetail] = useState<ConversationDetail | null>(null)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [composer, setComposer] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setConversationSummaries(initialConversations)
  }, [initialConversations])

  useEffect(() => {
    if (managerOptions.length === 0) {
      setSelectedManagerId(null)
      setSelectedConversationId(null)
      setConversationDetail(null)
      setMessages([])
      return
    }

    if (!selectedManagerId) {
      void handleSelectManager(managerOptions[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managerOptions])

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([])
      setConversationDetail(null)
      return
    }

    let cancelled = false

    async function loadConversation() {
      setLoading(true)
      setError(null)
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

        setConversationDetail(conversation)
        setMessages(conversation.messages ?? [])

        const lastMessage = conversation.messages?.[conversation.messages.length - 1] ?? null

        setConversationSummaries((current) =>
          current.map((item) =>
            item.id === conversation.id
              ? {
                  ...item,
                  subject: conversation.subject,
                  status: conversation.status,
                  updatedAt: item.updatedAt.toString(),
                  consultation: conversation.consultation ?? item.consultation,
                  lastMessage,
                }
              : item,
          ),
        )
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setError("メッセージを読み込めませんでした。")
          setMessages([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadConversation()

    return () => {
      cancelled = true
    }
  }, [selectedConversationId])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [messages, selectedManagerId])

  const filteredManagers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return managerOptions
    return managerOptions.filter((manager) => {
      const target = [manager.name ?? "", manager.email ?? ""].join(" ").toLowerCase()
      return target.includes(term)
    })
  }, [managerOptions, searchTerm])

  const displayMessages = useMemo(() => {
    if (!selectedManagerId) return []
    return messages.filter(
      (message) =>
        message.sender.id === currentUser.id ||
        (message.sender.id === selectedManagerId && message.sender.role !== "WORKER"),
    )
  }, [messages, selectedManagerId, currentUser.id])

  async function ensureConversation(manager: WorkerOption) {
    const existing = conversationSummaries.find((conversation) =>
      manager.groupIds.includes(conversation.group.id),
    )

    if (existing) {
      return existing
    }

    const groupId = manager.groupIds[0]
    if (!groupId) {
      return null
    }

    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          groupId,
          workerId: currentUser.id,
          subject: manager.name ? `${manager.name}さんとの相談` : "相談",
        }),
      })

      if (!res.ok) {
        throw new Error("failed to create conversation")
      }

      const data = (await res.json()) as {
        conversation: ConversationDetail & { messages: MessageItem[] }
        summary: ConversationSummary
      }

      setConversationSummaries((current) => [data.summary, ...current])
      return data.summary
    } catch (error) {
      console.error(error)
      setError("相談スレッドの作成に失敗しました。")
      return null
    }
  }

  async function handleSelectManager(manager: WorkerOption) {
    setSelectedManager(manager)
    setSelectedManagerId(manager.id)
    setError(null)

    const summary = await ensureConversation(manager)
    if (!summary) {
      setSelectedConversationId(null)
      setMessages([])
      setConversationDetail(null)
      return
    }

    setSelectedConversationId(summary.id)
  }

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
          language: "ja",
        }),
      })

      if (!res.ok) {
        throw new Error("failed to send")
      }

      const data = (await res.json()) as { message: MessageItem }
      setMessages((current) => [...current, data.message])
      setComposer("")
      setConversationSummaries((current) =>
        current.map((conversation) =>
          conversation.id === selectedConversationId
            ? {
                ...conversation,
                lastMessage: data.message,
                updatedAt: data.message.createdAt,
              }
            : conversation,
        ),
      )
    } catch (err) {
      console.error(err)
      setSendError("メッセージの送信に失敗しました。")
    } finally {
      setSending(false)
    }
  }

  function lastMessagePreview(manager: WorkerOption) {
    const summary = conversationSummaries.find((item) => manager.groupIds.includes(item.group.id))
    if (!summary?.lastMessage) return "メッセージなし"
    return summary.lastMessage.body.slice(0, 40)
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-1 overflow-hidden bg-slate-100">
      <div className="w-full max-w-[320px] border-r bg-white">
        <div className="px-4 pb-4 pt-6">
          <p className="text-lg font-semibold">担当者一覧</p>
          <Input
            className="mt-3 bg-slate-100"
            placeholder="担当者を検索"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
        <div className="space-y-2 overflow-y-auto px-3 pb-6">
          {filteredManagers.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">表示できる担当者がいません。</p>
          ) : (
            filteredManagers.map((manager) => {
              const isActive = manager.id === selectedManagerId
              const preview = lastMessagePreview(manager)
              return (
                <button
                  key={manager.id}
                  type="button"
                  onClick={() => handleSelectManager(manager)}
                  className={`w-full rounded-xl border bg-white p-4 text-left shadow-sm transition ${
                    isActive ? "border-[#0F2C82] shadow-md" : "border-transparent hover:border-slate-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{manager.name ?? manager.email ?? "担当者"}</p>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{preview}</p>
                </button>
              )
            })
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        {selectedManager && selectedConversationId ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b bg-white px-6 py-4">
              <div>
                <p className="text-lg font-semibold">{selectedManager.name ?? selectedManager.email}</p>
                <p className="text-xs text-muted-foreground">所属グループ: {conversationDetail?.group.name ?? "-"}</p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto bg-slate-50 px-6 py-6" ref={messagesContainerRef}>
              {loading ? (
                <p className="text-sm text-muted-foreground">読み込み中...</p>
              ) : error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : displayMessages.length === 0 ? (
                <div className="flex h-full flex-1 flex-col items-center justify-center text-muted-foreground">
                  <MessageSquare className="mb-3 h-10 w-10" />
                  <p className="text-sm">メッセージはまだありません。</p>
                </div>
              ) : (
                displayMessages.map((message) => {
                  const isWorker = message.sender.role === "WORKER"
                  return (
                    <div key={message.id} className={`flex ${isWorker ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`mb-4 max-w-[80%] rounded-2xl px-4 py-3 shadow ${
                          isWorker ? "bg-[#0F2C82] text-white" : "bg-white"
                        }`}
                      >
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>
                        {message.llmArtifact?.translation ? (
                          <p className={`mt-2 text-xs ${isWorker ? "text-white/80" : "text-slate-500"}`}>
                            {message.llmArtifact.translation}
                          </p>
                        ) : null}
                        <p className={`mt-2 text-[10px] ${isWorker ? "text-white/70" : "text-slate-400"}`}>
                          {new Date(message.createdAt).toLocaleTimeString("ja-JP", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <div className="border-t bg-white px-6 py-4">
              <form onSubmit={handleSendMessage} className="space-y-3">
                <Textarea
                  placeholder="メッセージを入力してください"
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  rows={3}
                />
                {sendError ? <p className="text-xs text-destructive">{sendError}</p> : null}
                <div className="flex items-center justify-end">
                  <Button type="submit" disabled={sending || !composer.trim()}>
                    {sending ? "送信中..." : "送信"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-slate-50">
            <div className="text-center text-muted-foreground">
              <MessageSquare className="mx-auto mb-3 h-10 w-10" />
              <p className="text-sm">担当者を選択してチャットを開始してください。</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// -------------------- Manager / Admin view --------------------

function ManagerChatDashboard({
  initialConversations,
  availableGroups,
  availableWorkers,
  currentUser,
}: ChatDashboardProps) {
  const [conversations, setConversations] = useState(initialConversations)
  const [view, setView] = useState<"chat" | "reports">("chat")
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    initialConversations[0]?.id ?? null,
  )
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [selectedConversation, setSelectedConversation] = useState<(ConversationDetail & {
    messages: MessageItem[]
  }) | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [composer, setComposer] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

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

  useEffect(() => {
    setConversations(initialConversations)
  }, [initialConversations])

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

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([])
      setSelectedConversation(null)
      return
    }

    let cancelled = false

    async function loadConversation() {
      setLoadingMessages(true)
      setLoadingError(null)
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

        setSelectedConversation(conversation)
        setMessages(conversation.messages ?? [])

        const lastMessage = conversation.messages?.[conversation.messages.length - 1] ?? null

        setConversations((current) =>
          current.map((item) =>
            item.id === conversation.id
              ? {
                  ...item,
                  subject: conversation.subject,
                  status: conversation.status,
                  updatedAt: item.updatedAt.toString(),
                  consultation: conversation.consultation ?? item.consultation,
                  lastMessage,
                }
              : item,
          ),
        )
      } catch (error) {
        console.error(error)
        if (!cancelled) {
          setLoadingError("メッセージを読み込めませんでした。")
          setMessages([])
        }
      } finally {
        if (!cancelled) {
          setLoadingMessages(false)
        }
      }
    }

    void loadConversation()

    return () => {
      cancelled = true
    }
  }, [selectedConversationId])

  const filteredConversations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return conversations
    return conversations.filter((item) => {
      const target = [
        item.worker?.name ?? "",
        item.subject ?? "",
        item.group.name,
        item.consultation?.category ?? "",
      ]
        .join(" ")
        .toLowerCase()
      return target.includes(term)
    })
  }, [conversations, searchTerm])

  const suggestionItems = useMemo(() => {
    if (!messages.length) return []
    const reversed = [...messages].reverse()
    for (const message of reversed) {
      if (message.llmArtifact?.suggestions?.length) {
        return message.llmArtifact.suggestions
      }
    }
    return []
  }, [messages])

  const consultation = selectedConversation?.consultation ?? null

  const stats = useMemo(() => {
    if (!consultation) {
      return {
        total: selectedConversation ? 1 : 0,
        resolved: selectedConversation && selectedConversation.status === "RESOLVED" ? 1 : 0,
        unresolved: selectedConversation && selectedConversation.status !== "RESOLVED" ? 1 : 0,
      }
    }
    return {
      total: 1,
      resolved: consultation.status === "RESOLVED" ? 1 : 0,
      unresolved: consultation.status === "RESOLVED" ? 0 : 1,
    }
  }, [consultation, selectedConversation])

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
          language: currentUser.role === "WORKER" ? "vi" : "ja",
        }),
      })

      if (!res.ok) {
        throw new Error("failed to send")
      }

      const data = (await res.json()) as { message: MessageItem }
      setMessages((current) => [...current, data.message])
      setComposer("")
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === selectedConversationId
            ? {
                ...conversation,
                lastMessage: data.message,
                updatedAt: data.message.createdAt,
              }
            : conversation,
        ),
      )
    } catch (error) {
      console.error(error)
      setSendError("メッセージの送信に失敗しました。")
    } finally {
      setSending(false)
    }
  }

  async function handleCreateConversation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

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
          language: currentUser.role === "WORKER" ? "vi" : "ja",
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

      setSelectedConversationId(data.conversation.id)
      setSelectedConversation(data.conversation)
      setMessages(data.conversation.messages ?? [])
      setConversations((current) => [data.summary, ...current.filter((item) => item.id !== data.summary.id)])
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

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-1 overflow-hidden bg-slate-50">
      <aside className="hidden h-full w-[72px] flex-col items-center justify-between bg-[#0F2C82] py-6 text-white lg:flex">
        <div className="flex flex-col items-center gap-6">
          <div className="rounded-full bg-white/10 px-3 py-2 text-sm font-semibold">CRM</div>
          <nav className="flex flex-col gap-4">
            {NAV_ITEMS.map((item) => {
              const active =
                (item.id === "chat" && view === "chat") || (item.id === "reports" && view === "reports")
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === "chat" || item.id === "reports") {
                      setView(item.id as "chat" | "reports")
                    }
                  }}
                  className={`group flex h-10 w-10 items-center justify-center rounded-lg transition ${
                    active ? "bg-white text-[#0F2C82]" : "text-white/70 hover:bg-white/10"
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                </button>
              )
            })}
          </nav>
        </div>
        <div className="flex flex-col items-center gap-4">
          <LogOut className="h-5 w-5 text-white/70" />
        </div>
      </aside>

      <section className="flex h-full flex-1 flex-col lg:flex-row">
        <div className="w-full border-b bg-white lg:w-[320px] lg:border-r">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <div>
              <p className="text-lg font-semibold">相談者一覧</p>
              <p className="text-xs text-muted-foreground">相談者を検索...</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen((prev) => !prev)}>
              {createOpen ? "閉じる" : "新規"}
            </Button>
          </div>
          <div className="px-4 pb-4">
            <Input
              placeholder="相談者を検索..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="bg-slate-100"
            />
          </div>

          {createOpen ? (
            <div className="px-4 pb-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">相談を新規作成</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreateConversation} className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="create-group">グループ</Label>
                      <select
                        id="create-group"
                        className="w-full rounded-md border bg-white p-2 text-sm"
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
                          className="w-full rounded-md border bg-white p-2 text-sm"
                          value={createWorkerId}
                          onChange={(event) => setCreateWorkerId(event.target.value)}
                        >
                          {availableWorkers
                            .filter((worker) =>
                              !createGroupId ? true : worker.groupIds.includes(createGroupId),
                            )
                            .map((worker) => (
                              <option key={worker.id} value={worker.id}>
                                {worker.name ?? worker.email ?? "利用者"}
                              </option>
                            ))}
                        </select>
                      </div>
                    ) : null}
                    <div className="space-y-1">
                      <Label htmlFor="create-subject">件名</Label>
                      <Input
                        id="create-subject"
                        placeholder="相談の概要"
                        value={createSubject}
                        onChange={(event) => setCreateSubject(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="create-message">最初のメッセージ</Label>
                      <Textarea
                        id="create-message"
                        rows={3}
                        placeholder="最初のメッセージを入力"
                        value={createMessage}
                        onChange={(event) => setCreateMessage(event.target.value)}
                      />
                    </div>
                    {createError ? <p className="text-xs text-destructive">{createError}</p> : null}
                    <Button type="submit" className="w-full" disabled={creating}>
                      {creating ? "作成中..." : "相談を作成"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          ) : null}

          <div className="space-y-2 overflow-y-auto px-2 pb-6">
            {filteredConversations.length === 0 ? (
              <p className="px-4 text-sm text-muted-foreground">一致する相談者が見つかりません。</p>
            ) : (
              filteredConversations.map((conversation) => {
                const isActive = conversation.id === selectedConversationId
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => setSelectedConversationId(conversation.id)}
                    className={`w-full rounded-lg border bg-white p-4 text-left shadow-sm transition ${
                      isActive ? "border-[#0F2C82] shadow-md" : "border-transparent hover:border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold">{conversation.worker?.name ?? "相談"}</p>
                        <p className="text-xs text-muted-foreground">{conversation.subject ?? "件名なし"}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(conversation.updatedAt).toLocaleTimeString("ja-JP", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline">{conversation.group.name}</Badge>
                      {conversation.consultation ? (
                        <Badge variant="secondary">{conversation.consultation.category}</Badge>
                      ) : null}
                      {conversation.consultation ? (
                        <Badge className="bg-red-100 text-red-700">
                          {CASE_PRIORITY_LABEL[conversation.consultation.priority]}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {conversation.lastMessage?.body?.slice(0, 60) ?? "メッセージなし"}
                    </p>
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          {view === "chat" ? (
            <ChatView
              conversation={selectedConversation}
              messages={messages}
              loadingMessages={loadingMessages}
              loadingError={loadingError}
              composer={composer}
              onComposerChange={setComposer}
              onSend={handleSendMessage}
              sending={sending}
              sendError={sendError}
              suggestions={suggestionItems}
              consultation={consultation}
            />
          ) : (
            <ReportView
              conversations={filteredConversations}
              selectedConversation={selectedConversation}
              onSelect={(id) => setSelectedConversationId(id)}
              stats={stats}
              consultation={consultation}
            />
          )}
        </div>
      </section>
    </div>
  )
}

function ChatView(props: {
  conversation: (ConversationDetail & { messages: MessageItem[] }) | null
  messages: MessageItem[]
  loadingMessages: boolean
  loadingError: string | null
  composer: string
  onComposerChange: (value: string) => void
  onSend: (event: React.FormEvent<HTMLFormElement>) => void
  sending: boolean
  sendError: string | null
  suggestions: Array<{ content: string; tone?: string; language?: string }>
  consultation: ConsultationCase | (ConsultationCase & { description?: string | null }) | null
}) {
  const {
    conversation,
    messages,
    loadingMessages,
    loadingError,
    composer,
    onComposerChange,
    onSend,
    sending,
    sendError,
    suggestions,
    consultation,
  } = props

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <div className="flex-1 border-b bg-white lg:border-r">
        {conversation ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <p className="text-lg font-semibold">{conversation.worker.name ?? "相談"}</p>
                <p className="text-xs text-muted-foreground">{conversation.subject ?? "件名なし"}</p>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50 px-6 py-6">
              {loadingMessages ? (
                <p className="text-sm text-muted-foreground">読み込み中...</p>
              ) : loadingError ? (
                <p className="text-sm text-destructive">{loadingError}</p>
              ) : messages.length === 0 ? (
                <div className="flex h-full flex-1 flex-col items-center justify-center text-muted-foreground">
                  <Bot className="mb-3 h-10 w-10" />
                  <p className="text-sm">相談者を選択してメッセージを開始</p>
                </div>
              ) : (
                messages.map((message) => {
                  const isWorker = message.sender.role === "WORKER"
                  return (
                    <div key={message.id} className={`flex ${isWorker ? "justify-start" : "justify-end"}`}>
                      <div
                        className={`max-w-[75%] rounded-xl px-4 py-3 shadow-sm ${
                          isWorker ? "bg-white" : "bg-[#0F2C82] text-white"
                        }`}
                      >
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>
                        {message.llmArtifact?.translation ? (
                          <p className={`mt-2 text-xs ${isWorker ? "text-slate-500" : "text-white/80"}`}>
                            {message.llmArtifact.translation}
                          </p>
                        ) : null}
                        <p className={`mt-1 text-[10px] ${isWorker ? "text-slate-400" : "text-white/70"}`}>
                          {new Date(message.createdAt).toLocaleTimeString("ja-JP", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div className="border-t bg-white px-6 py-4">
              <form onSubmit={onSend} className="space-y-3">
                <Textarea
                  placeholder="AI提案を選択するか自分で入力してください"
                  value={composer}
                  onChange={(event) => onComposerChange(event.target.value)}
                  rows={3}
                />
                {sendError ? <p className="text-xs text-destructive">{sendError}</p> : null}
                <div className="flex items-center justify-end gap-3">
                  <Button type="submit" disabled={sending || !composer.trim()}>
                    {sending ? "送信中..." : "送信"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center bg-slate-50">
            <div className="text-center text-muted-foreground">
              <MessageSquare className="mx-auto mb-3 h-10 w-10" />
              <p className="text-sm">相談者を選択してメッセージを開始</p>
            </div>
          </div>
        )}
      </div>

      <div className="hidden w-full flex-col gap-4 border-l bg-white p-6 lg:flex lg:w-[320px] xl:w-[360px]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">AI提案返信</h2>
            <Button variant="ghost" size="sm">
              再生成
            </Button>
          </div>
          <div className="space-y-3">
            {suggestions.length === 0 ? (
              <p className="text-xs text-muted-foreground">AI提案はまだありません。</p>
            ) : (
              suggestions.map((suggestion, index) => (
                <Card key={`${suggestion.content}-${index}`} className="border-slate-200">
                  <CardContent className="space-y-2 p-3">
                    {suggestion.tone ? (
                      <Badge variant="secondary" className="w-fit capitalize">
                        {suggestion.tone}
                      </Badge>
                    ) : null}
                    <p className="text-sm leading-relaxed">{suggestion.content}</p>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold">相談者情報</h2>
          {conversation ? (
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-semibold">{conversation.worker.name}</p>
                <p className="text-xs text-muted-foreground">{conversation.group.name}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{conversation.status}</Badge>
                {consultation ? (
                  <Badge variant="secondary">{consultation.category}</Badge>
                ) : null}
                {consultation ? (
                  <Badge className="bg-red-100 text-red-700">
                    {CASE_PRIORITY_LABEL[consultation.priority]}
                  </Badge>
                ) : null}
              </div>
              {consultation?.summary ? (
                <div className="rounded-md bg-slate-100 p-3 text-xs text-slate-600">
                  {consultation.summary}
                </div>
              ) : null}
              {consultation?.description ? (
                <div className="rounded-md border border-dashed p-3 text-xs text-slate-600">
                  {consultation.description}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">相談者を選択すると詳細が表示されます。</p>
          )}
        </section>
      </div>
    </div>
  )
}

function ReportView(props: {
  conversations: ConversationSummary[]
  selectedConversation: (ConversationDetail & { messages: MessageItem[] }) | null
  onSelect: (id: string) => void
  stats: { total: number; resolved: number; unresolved: number }
  consultation: ConsultationCase | (ConsultationCase & { description?: string | null }) | null
}) {
  const { conversations, selectedConversation, onSelect, stats, consultation } = props

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b px-6 py-4">
        <h2 className="text-lg font-semibold">報告書作成</h2>
        <p className="text-xs text-muted-foreground">相談者を選択して報告書を作成</p>
      </div>
      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="w-full border-b lg:w-[320px] lg:border-r">
          <div className="space-y-2 overflow-y-auto px-4 py-6">
            {conversations.map((conversation) => {
              const isActive = selectedConversation?.id === conversation.id
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className={`w-full rounded-lg border bg-white p-4 text-left shadow-sm transition ${
                    isActive ? "border-[#0F2C82] shadow-md" : "border-transparent hover:border-slate-200"
                  }`}
                >
                  <p className="text-sm font-semibold">{conversation.worker?.name ?? "相談"}</p>
                  <p className="text-xs text-muted-foreground">相談履歴: {conversation.consultation ? 1 : 0}件</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {conversation.consultation ? (
                      <Badge variant="secondary">{conversation.consultation.category}</Badge>
                    ) : null}
                    {conversation.consultation ? (
                      <Badge className="bg-red-100 text-red-700">
                        {CASE_PRIORITY_LABEL[conversation.consultation.priority]}
                      </Badge>
                    ) : null}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {selectedConversation ? (
            <Card className="border-slate-200">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">
                  {selectedConversation.worker.name} - 相談履歴報告書
                </CardTitle>
                <p className="text-xs text-muted-foreground">総相談件数: {stats.total}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-3">
                  <ReportCounter label="総相談件数" value={stats.total} />
                  <ReportCounter label="解決済み" value={stats.resolved} highlight />
                  <ReportCounter label="対応中" value={stats.unresolved} />
                </div>
                <Separator />
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">相談履歴詳細</h3>
                  {consultation ? (
                    <ReportCard
                      title={consultation.category}
                      subtitle={CASE_STATUS_LABEL[consultation.status]}
                      description={consultation.description ?? "詳細は登録されていません。"}
                      tags={[consultation.category, CASE_PRIORITY_LABEL[consultation.priority]]}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">相談履歴はまだ登録されていません。</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex h-full flex-1 flex-col items-center justify-center text-muted-foreground">
              <BarChart3 className="mb-3 h-10 w-10" />
              <p className="text-sm">相談者を選択して報告書を作成</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ReportCounter({
  label,
  value,
  highlight = false,
}: {
  label: string
  value: number
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-xl border p-4 shadow-sm ${
        highlight ? "border-[#0F2C82] bg-[#0F2C82]/5" : "border-slate-200"
      }`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[#0F2C82]">{value}</p>
    </div>
  )
}

function ReportCard({
  title,
  subtitle,
  description,
  tags,
}: {
  title: string
  subtitle?: string
  description: string
  tags?: string[]
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {tags ? (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-slate-600">{description}</p>
    </div>
  )
}
