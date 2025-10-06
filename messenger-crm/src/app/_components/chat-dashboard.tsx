"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { BarChart3, Bot, LogOut, MessageSquare, Settings, Users } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

const NAV_ITEMS = [
  { id: "chat", href: "/", icon: MessageSquare, label: "相談" },
  { id: "users", href: "/users", icon: Users, label: "顧客" },
  { id: "reports", href: "/reports", icon: BarChart3, label: "レポート" },
  { id: "settings", href: "/settings", icon: Settings, label: "設定" },
]

const CASE_PRIORITY_LABEL: Record<CasePriority, string> = {
  HIGH: "緊急",
  MEDIUM: "中",
  LOW: "低",
}

const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  IN_PROGRESS: "対応中",
  RESOLVED: "解決済み",
  ESCALATED: "エスカレーション",
  ON_HOLD: "保留",
}

export function ChatDashboard(props: ChatDashboardProps) {
  if (props.currentUser.role === "WORKER") {
    return <WorkerChatDashboard {...props} />
  }

  return <ManagerChatDashboard {...props} />
}

// -----------------------------------------------------------------------------
// Manager / Admin layout
// -----------------------------------------------------------------------------

function ManagerChatDashboard({
  initialConversations,
  availableGroups,
  availableWorkers,
  currentUser,
}: ChatDashboardProps) {
  const [conversations, setConversations] = useState(initialConversations)
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
  const [createWorkerId, setCreateWorkerId] = useState<string>(() => availableWorkers[0]?.id ?? "")
  const [createSubject, setCreateSubject] = useState("")
  const [createMessage, setCreateMessage] = useState("")
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const messagesRef = useRef<HTMLDivElement | null>(null)

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
    setCreateWorkerId((prev) => {
      if (
        prev &&
        availableWorkers.some((worker) => worker.id === prev && (!createGroupId || worker.groupIds.includes(createGroupId)))
      ) {
        return prev
      }
      const fallback = availableWorkers.find((worker) =>
        !createGroupId || worker.groupIds.length === 0 ? true : worker.groupIds.includes(createGroupId),
      )
      return fallback?.id ?? ""
    })
  }, [availableWorkers, createGroupId])

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
                  consultation: conversation.consultation ?? item.consultation,
                  lastMessage,
                  updatedAt: toIsoString(conversation.updatedAt),
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

  useEffect(() => {
    const container = messagesRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [messages, selectedConversationId])

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
    <div className="flex h-[calc(100vh-4rem)] flex-1 overflow-hidden bg-[#f4f7fb]">
      <ManagerSidebar />

      <section className="flex h-full flex-1 flex-col lg:flex-row">
        <div className="flex w-full flex-col border-r bg-white lg:max-w-[320px]">
          <div className="px-4 pb-4 pt-6">
            <p className="text-lg font-semibold">相談者一覧</p>
            <Input
              className="mt-3 bg-slate-100"
              placeholder="相談者を検索する..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <div className="mt-3 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setCreateOpen((prev) => !prev)}>
                {createOpen ? "閉じる" : "新規"}
              </Button>
            </div>
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
                    <div className="space-y-1">
                      <Label htmlFor="create-worker">担当ユーザー</Label>
                      <select
                        id="create-worker"
                        className="w-full rounded-md border bg-white p-2 text-sm"
                        value={createWorkerId}
                        onChange={(event) => setCreateWorkerId(event.target.value)}
                      >
                        {availableWorkers
                          .filter((worker) => (!createGroupId ? true : worker.groupIds.includes(createGroupId)))
                          .map((worker) => (
                            <option key={worker.id} value={worker.id}>
                              {worker.name ?? worker.email ?? "利用者"}
                            </option>
                          ))}
                      </select>
                    </div>
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
                    className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition ${
                      isActive ? "border-[#0F2C82] shadow-md" : "border-transparent hover:border-slate-200"
                    }`}
                  >
                    <ConversationListItem conversation={conversation} />
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
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
            messagesRef={messagesRef}
            showSidePanel
          />
        </div>
      </section>
    </div>
  )
}

function ManagerSidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden h-full w-[88px] min-h-[calc(100vh-4rem)] flex-col bg-[#0F2C82] text-white lg:flex">
      <nav className="flex flex-1 flex-col items-center gap-8 py-10">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-label={item.label}
              className={`flex h-12 w-12 items-center justify-center rounded-2xl transition ${
                active ? "bg-white text-[#0F2C82]" : "text-white/70 hover:bg-white/15"
              }`}
            >
              <Icon className="h-5 w-5" />
            </Link>
          )
        })}
      </nav>
      <div className="flex items-center justify-center pb-8">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
          aria-label="ログアウト"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </aside>
  )
}

// -----------------------------------------------------------------------------
// Worker layout (mobile friendly)
// -----------------------------------------------------------------------------

function WorkerChatDashboard({
  initialConversations,
  availableWorkers,
  currentUser,
}: ChatDashboardProps) {
  const router = useRouter()
  const managerOptions = useMemo(
    () => availableWorkers.filter((worker) => worker.id !== currentUser.id),
    [availableWorkers, currentUser.id],
  )

  const [conversations, setConversations] = useState(initialConversations)
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
  const [mobileView, setMobileView] = useState<"list" | "chat">("list")
  const messagesRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setConversations(initialConversations)
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
      setConversationDetail(null)
      setMessages([])
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
        setConversations((current) =>
          current.map((item) =>
            item.id === conversation.id
              ? {
                  ...item,
                  subject: conversation.subject,
                  status: conversation.status,
                  consultation: conversation.consultation ?? item.consultation,
                  lastMessage,
                  updatedAt: toIsoString(conversation.updatedAt),
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
    const container = messagesRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [messages, selectedConversationId])

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
    const existing = conversations.find((conversation) => manager.groupIds.includes(conversation.group.id))
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

      setConversations((current) => [data.summary, ...current])
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
      return
    }

    setSelectedConversationId(summary.id)
    setMobileView("chat")
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
    } catch (err) {
      console.error(err)
      setSendError("メッセージの送信に失敗しました。")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-1 overflow-hidden bg-[#f4f7fb]">
      <div className="flex w-full lg:max-w-[320px] lg:flex-col lg:border-r lg:bg-white">
        <div className="flex w-full items-center justify-between bg-white px-4 py-4 lg:hidden">
          <div className="flex gap-3">
            <Button
              variant={mobileView === "list" ? "default" : "outline"}
              size="sm"
              onClick={() => setMobileView("list")}
              aria-pressed={mobileView === "list"}
            >
              担当者
            </Button>
            <Button
              variant={mobileView === "chat" ? "default" : "outline"}
              size="sm"
              onClick={() => setMobileView("chat")}
              aria-pressed={mobileView === "chat"}
            >
              チャット
            </Button>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            onClick={() => router.push("/settings")}
            aria-label="設定"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>

        <div className={`flex-1 overflow-y-auto bg-white ${mobileView === "chat" ? "hidden lg:block" : "block"}`}>
          <div className="px-4 pb-4 pt-6">
            <p className="text-lg font-semibold">担当者一覧</p>
            <Input
              className="mt-3 bg-slate-100"
              placeholder="担当者を検索"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
          <div className="space-y-2 px-3 pb-6">
            {filteredManagers.length === 0 ? (
              <p className="px-2 text-sm text-muted-foreground">表示できる担当者がいません。</p>
            ) : (
              filteredManagers.map((manager) => {
                const isActive = manager.id === selectedManagerId
                const preview = getLastMessagePreview(conversations, manager)
                const time = getLastMessageTime(conversations, manager)
                return (
                  <button
                    key={manager.id}
                    type="button"
                    onClick={() => void handleSelectManager(manager)}
                    className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition ${
                      isActive ? "border-[#0F2C82] shadow-md" : "border-transparent hover:border-slate-200"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback>{getInitials(manager.name ?? manager.email)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold">{manager.name ?? manager.email ?? "担当者"}</p>
                          <span className="text-xs text-muted-foreground">{time}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{preview}</p>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>

      <div className={`flex flex-1 flex-col ${mobileView === "list" ? "hidden lg:flex" : "flex"}`}>
        <div className="hidden items-center justify-end gap-3 bg-white px-4 py-3 shadow-sm lg:flex">
          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            onClick={() => router.push("/settings")}
            aria-label="設定"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>

        {selectedManager && selectedConversationId ? (
          <ChatView
            conversation={conversationDetail}
            messages={displayMessages}
            loadingMessages={loading}
            loadingError={error}
            composer={composer}
            onComposerChange={setComposer}
            onSend={handleSendMessage}
            sending={sending}
            sendError={sendError}
            suggestions={[]}
            consultation={conversationDetail?.consultation ?? null}
            messagesRef={messagesRef}
            showSidePanel={false}
          />
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

// -----------------------------------------------------------------------------
// Shared presentation components
// -----------------------------------------------------------------------------

type ChatViewProps = {
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
  messagesRef?: React.RefObject<HTMLDivElement>
  showSidePanel?: boolean
}

function ChatView({
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
  messagesRef,
  showSidePanel = true,
}: ChatViewProps) {
  const internalRef = useRef<HTMLDivElement | null>(null)
  const mergedRef = messagesRef ?? internalRef
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const container = mergedRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [mergedRef, messages, conversation?.id])

  const latestMessage = messages[messages.length - 1] ?? null
  const toneLabelMap: Record<string, string> = {
    question: "質問",
    empathy: "共感",
    solution: "解決策",
    summary: "要約",
  }
  const localeLabel = conversation?.worker.locale ? getLocaleLabel(conversation.worker.locale) : null
  const statusLabel = conversation ? CASE_STATUS_LABEL[conversation.status as CaseStatus] ?? conversation.status : null

  return (
    <div className={`flex h-full flex-1 ${showSidePanel ? "lg:flex-row" : "flex-col"}`}>
      <div className="flex flex-1 flex-col border-b bg-white lg:border-r">
        {conversation ? (
          <>
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <p className="text-lg font-semibold">{conversation.worker.name ?? "相談"}</p>
                <p className="text-xs text-muted-foreground">{conversation.subject ?? "件名なし"}</p>
              </div>
            </div>
            <div ref={mergedRef} className="flex-1 space-y-4 overflow-y-auto bg-slate-50 px-6 py-6">
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
                        className={`max-w-[75%] rounded-2xl px-4 py-3 shadow-sm ${
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
                ref={composerRef}
              />
              {sendError ? <p className="text-xs text-destructive">{sendError}</p> : null}
              <div className="flex items-center justify-end gap-3">
                <Button type="submit" disabled={sending || !composer.trim()}>
                  {sending ? "送信中..." : "送信"}
                  </Button>
                </div>
              </form>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center bg-slate-50">
            <div className="text-center text-muted-foreground">
              <MessageSquare className="mx-auto mb-3 h-10 w-10" />
              <p className="text-sm">相談者を選択してメッセージを開始</p>
            </div>
          </div>
        )}
      </div>

      {showSidePanel ? (
        <aside className="hidden h-full w-full max-w-[400px] flex-col gap-6 border-l bg-[#f5f7ff] px-5 py-6 lg:flex">
          <section className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-800">AI提案返信</h2>
              <Button variant="outline" size="sm" className="gap-1">
                <Bot className="h-4 w-4" />
                再生成
              </Button>
            </div>
            <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
              {suggestions.length === 0 ? (
                <p className="text-xs text-muted-foreground">AI提案はまだありません。メッセージを受信すると自動生成されます。</p>
              ) : (
                suggestions.map((suggestion, index) => {
                  const toneKey = suggestion.tone ? suggestion.tone.toLowerCase() : ""
                  const toneLabel = toneLabelMap[toneKey] ?? suggestion.tone ?? "提案"
                  const languageLabel = suggestion.language ? suggestion.language.toUpperCase() : null
                  return (
                    <button
                      key={`${suggestion.content}-${index}`}
                      type="button"
                      onClick={() => {
                        onComposerChange(suggestion.content)
                        composerRef.current?.focus()
                      }}
                      className="w-full text-left"
                    >
                      <Card className="border border-slate-200 shadow-sm transition hover:border-[#0F2C82]/40 hover:shadow-md">
                        <CardContent className="space-y-2 p-4">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[11px] font-medium">
                              {toneLabel}
                            </Badge>
                            {languageLabel ? <span>{languageLabel}</span> : null}
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                            {suggestion.content}
                          </p>
                        </CardContent>
                      </Card>
                    </button>
                  )
                })
              )}
            </div>
            <div className="mt-4 space-y-3">
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => composerRef.current?.focus()}
              >
                自分で入力する
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                AI提案を選択するか、自分で入力して返信を作成してください。
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800">相談者情報</h2>
            {conversation ? (
              <div className="mt-4 space-y-4 text-sm text-slate-700">
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback>{getInitials(conversation.worker.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold">{conversation.worker.name ?? "相談者"}</p>
                    <p className="text-xs text-muted-foreground">
                      {[localeLabel, conversation.group.name].filter(Boolean).join(" ・ ")}
                    </p>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-muted-foreground">
                  <p className="font-semibold text-slate-700">ステータス</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {statusLabel ? <Badge variant="outline">{statusLabel}</Badge> : null}
                    {consultation ? <Badge variant="secondary">{consultation.category}</Badge> : null}
                    {consultation ? (
                      <Badge className="bg-red-100 text-red-700">
                        {CASE_PRIORITY_LABEL[consultation.priority]}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                {latestMessage ? (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p className="font-semibold text-slate-700">最新メッセージ</p>
                    <p className="rounded-xl bg-slate-50 p-3 text-[12px] text-slate-600">
                      {latestMessage.body}
                    </p>
                  </div>
                ) : null}

                {consultation?.summary ? (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p className="font-semibold text-slate-700">AI分析サマリー</p>
                    <p className="rounded-xl bg-slate-50 p-3 text-[12px] text-slate-600">
                      {consultation.summary}
                    </p>
                  </div>
                ) : null}

                {consultation?.description ? (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p className="font-semibold text-slate-700">相談内容メモ</p>
                    <p className="rounded-xl border border-dashed border-slate-200 p-3 text-[12px] text-slate-600">
                      {consultation.description}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">相談者を選択すると詳細が表示されます。</p>
            )}
          </section>
        </aside>
      ) : null}
    </div>
  )
}

function ConversationListItem({ conversation }: { conversation: ConversationSummary }) {
  return (
    <div className="flex items-start gap-3">
      <Avatar className="h-10 w-10">
        <AvatarFallback>{getInitials(conversation.worker?.name)}</AvatarFallback>
      </Avatar>
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">{conversation.worker?.name ?? "相談"}</p>
          <span className="text-xs text-muted-foreground">{formatRelativeTime(conversation.updatedAt)}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{conversation.subject ?? "件名なし"}</p>
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
      </div>
    </div>
  )
}

function getInitials(name?: string | null) {
  if (!name) return "--"
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function getLocaleLabel(locale: string) {
  const normalized = locale.toLowerCase()
  switch (normalized) {
    case "ja":
    case "ja-jp":
      return "日本語"
    case "vi":
    case "vi-vn":
      return "ベトナム語"
    case "en":
    case "en-us":
      return "英語"
    case "id":
    case "id-id":
      return "インドネシア語"
    case "tl":
    case "fil":
      return "タガログ語"
    default:
      return locale
  }
}

function toIsoString(value: unknown) {
  if (!value) {
    return new Date().toISOString()
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === "string") {
    return value
  }

  const parsed = new Date(value as string | number)
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString()
  }
  return parsed.toISOString()
}

function formatRelativeTime(isoString: string) {
  const target = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - target.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)
  if (diffMinutes < 1) return "たった今"
  if (diffMinutes < 60) return `${diffMinutes}分前`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}時間前`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}日前`
  return target.toLocaleDateString("ja-JP", { month: "long", day: "numeric" })
}

function getLastMessagePreview(conversations: ConversationSummary[], manager: WorkerOption) {
  const summary = conversations.find((conversation) => manager.groupIds.includes(conversation.group.id))
  if (!summary?.lastMessage) return "メッセージなし"
  return summary.lastMessage.body.slice(0, 40)
}

function getLastMessageTime(conversations: ConversationSummary[], manager: WorkerOption) {
  const summary = conversations.find((conversation) => manager.groupIds.includes(conversation.group.id))
  if (!summary) return "--"
  return formatRelativeTime(summary.updatedAt)
}
