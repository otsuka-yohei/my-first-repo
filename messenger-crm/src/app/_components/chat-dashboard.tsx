"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Bot, ExternalLink, MessageSquare, Settings, X } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { AppSidebar } from "./app-sidebar"
import { MedicalFacilitiesList, type MedicalFacility } from "./medical-facility-card"
import type { CasePriority, CaseStatus } from "@prisma/client"

type UserRole = "WORKER" | "MANAGER" | "AREA_MANAGER" | "SYSTEM_ADMIN"

type MessageItem = {
  id: string
  body: string
  language: string
  type: "TEXT" | "IMAGE" | "FILE" | "SYSTEM"
  createdAt: string
  metadata?: {
    type?: string
    facilities?: MedicalFacility[]
    healthAnalysis?: {
      isHealthRelated: boolean
      symptomType?: string
      urgency?: string
      needsMedicalFacility?: boolean
      suggestedQuestions?: string[]
    }
  } | null
  sender: {
    id: string
    name: string | null
    role: UserRole
  }
  llmArtifact?: {
    translation?: string | null
    translationLang?: string | null
    suggestions?: Array<{ content: string; tone?: string; language?: string; translation?: string; translationLang?: string }>
    extra?: {
      healthAnalysis?: {
        isHealthRelated: boolean
        symptomType?: string
        urgency?: string
        needsMedicalFacility?: boolean
        suggestedQuestions?: string[]
      }
      medicalFacilities?: MedicalFacility[]
    }
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

type ConversationSegment = {
  id: string
  title: string
  summary: string | null
  messageIds: string[]
  startedAt: string
  endedAt: string
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
  worker: { id: string; name: string | null; locale: string | null; notes?: string | null }
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

const DEFAULT_LANGUAGE = "ja"

// URL検出用の正規表現
const URL_REGEX = /(https?:\/\/[^\s]+)/g

// URLを検出してリンク化する関数
function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX)
  return matches ? Array.from(new Set(matches)) : []
}

// テキストをURLでリンク化
function linkifyText(text: string) {
  const parts = text.split(URL_REGEX)
  return parts.map((part, index) => {
    if (part.match(URL_REGEX)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-1 underline-offset-2 hover:decoration-2"
        >
          {part}
        </a>
      )
    }
    return part
  })
}

function usePreferredLanguage(defaultLanguage = DEFAULT_LANGUAGE) {
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

type DashboardViewProps = ChatDashboardProps & { preferredLanguage: string }

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

const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  IN_PROGRESS: "対応中",
  RESOLVED: "解決済み",
  ESCALATED: "エスカレーション",
  ON_HOLD: "保留",
}

export function ChatDashboard(props: ChatDashboardProps) {
  const preferredLanguage = usePreferredLanguage()
  if (props.currentUser.role === "WORKER") {
    return <WorkerChatDashboard {...props} preferredLanguage={preferredLanguage} />
  }

  return <ManagerChatDashboard {...props} preferredLanguage={preferredLanguage} />
}

// -----------------------------------------------------------------------------
// Manager / Admin layout
// -----------------------------------------------------------------------------

function ManagerChatDashboard({
  initialConversations,
  availableGroups: _availableGroups,
  availableWorkers,
  currentUser,
  preferredLanguage,
}: DashboardViewProps) {
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
  const [selectedSuggestion, setSelectedSuggestion] = useState<{
    text: string
    index: number
  } | null>(null)
  const [removedTags, setRemovedTags] = useState<Record<string, string[]>>({})
  const [customTags, setCustomTags] = useState<Record<string, string[]>>({})
  const [tagDraft, setTagDraft] = useState("")
  const [regeneratingSuggestions, setRegeneratingSuggestions] = useState(false)
  const [regenerateError, setRegenerateError] = useState<string | null>(null)
  const [segments, setSegments] = useState<ConversationSegment[]>([])
  const [loadingSegments, setLoadingSegments] = useState(false)
  const [generatingSegments, setGeneratingSegments] = useState(false)
  const [initialSuggestions, setInitialSuggestions] = useState<Record<string, Array<{ content: string; tone?: string; language?: string; translation?: string; translationLang?: string }>>>({})
  const [workerNotes, setWorkerNotes] = useState("")
  const [savingNotes, setSavingNotes] = useState(false)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const workerDirectory = useMemo(() => {
    const map: Record<string, WorkerOption> = {}
    for (const worker of availableWorkers) {
      map[worker.id] = worker
    }
    return map
  }, [availableWorkers])

  useEffect(() => {
    setConversations(initialConversations)
  }, [initialConversations])

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
        // placeholder IDの場合は会話を作成
        if (selectedConversationId.startsWith("placeholder-")) {
          const workerId = selectedConversationId.replace("placeholder-", "")
          const worker = workerDirectory[workerId]
          if (!worker || !worker.groupIds[0]) {
            throw new Error("Worker not found or has no group")
          }

          // 会話を作成
          const createRes = await fetch("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              groupId: worker.groupIds[0],
              workerId: workerId,
              subject: `${worker.name}さんとの相談`,
            }),
          })

          if (!createRes.ok) {
            throw new Error("Failed to create conversation")
          }

          const createData = await readJson<{
            conversation: ConversationDetail & { messages: MessageItem[] }
          }>(createRes)

          if (cancelled) return

          const { conversation } = createData

          // 新しい会話IDで選択を更新
          setSelectedConversationId(conversation.id)

          // 会話リストを更新
          setConversations((current) =>
            current.map((item) =>
              item.id === selectedConversationId
                ? {
                    id: conversation.id,
                    subject: conversation.subject,
                    status: conversation.status,
                    updatedAt: toIsoString(conversation.updatedAt),
                    group: conversation.group,
                    worker: conversation.worker ?? null,
                    lastMessage: null,
                    consultation: null,
                  }
                : item,
            ),
          )

          setSelectedConversation(conversation)
          setMessages([])
          setLoadingMessages(false)
          return
        }

        const res = await fetch(`/api/conversations/${selectedConversationId}/messages`, {
          method: "GET",
          cache: "no-store",
        })
        if (!res.ok) {
          throw new Error("Failed to load conversation")
        }
        const data = await readJson<{
          conversation: ConversationDetail & { messages: MessageItem[] }
        }>(res)
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
                  updatedAt: toIsoString(item.updatedAt),
                }
              : item,
          ),
        )

        // メッセージがない場合は初回メッセージ提案を自動生成
        if (conversation.messages.length === 0) {
          void handleRegenerateSuggestions()
        }
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
  }, [selectedConversationId, workerDirectory])

  useEffect(() => {
    setTagDraft("")
    setRegenerateError(null)
    setRegeneratingSuggestions(false)
    setSegments([])
    setLoadingSegments(false)
    setGeneratingSegments(false)
    setWorkerNotes(selectedConversation?.worker?.notes ?? "")

    if (selectedConversationId) {
      void loadSegments(selectedConversationId)
    }
  }, [selectedConversationId, selectedConversation?.worker?.notes])

  async function loadSegments(conversationId: string) {
    setLoadingSegments(true)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/segments`, {
        method: "GET",
        cache: "no-store",
      })
      if (res.ok) {
        const data = await res.json() as { segments: ConversationSegment[] }
        setSegments(data.segments ?? [])
      }
    } catch (error) {
      console.error("Failed to load segments", error)
    } finally {
      setLoadingSegments(false)
    }
  }

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
    // メッセージがない場合は初回提案を使用
    if (!messages.length && selectedConversationId) {
      return initialSuggestions[selectedConversationId] ?? []
    }

    const reversed = [...messages].reverse()
    for (const message of reversed) {
      if (message.llmArtifact?.suggestions?.length) {
        return message.llmArtifact.suggestions
      }
    }
    return []
  }, [messages, initialSuggestions, selectedConversationId])

  const consultation = selectedConversation?.consultation ?? null

  const removedForSelected = selectedConversationId ? removedTags[selectedConversationId] ?? [] : []
  const customForSelected = selectedConversationId ? customTags[selectedConversationId] ?? [] : []

  const selectedConversationTags = useMemo(() => {
    if (!selectedConversation) return []
    return buildConversationTags(selectedConversation, removedForSelected, customForSelected)
  }, [selectedConversation, removedForSelected, customForSelected])

  async function handleSendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedConversationId || !composer.trim()) {
      return
    }

    setSending(true)
    setSendError(null)

    // 楽観的UI更新：送信前に即座にメッセージを表示
    const optimisticMessage = {
      id: `temp-${Date.now()}`,
      conversationId: selectedConversationId,
      senderId: currentUser.id,
      body: composer.trim(),
      language: currentUser.role === "WORKER" ? "vi" : "ja",
      type: "TEXT" as const,
      contentUrl: null,
      metadata: null,
      createdAt: new Date().toISOString(),
      sender: {
        id: currentUser.id,
        name: currentUser.name ?? null,
        role: currentUser.role,
      },
      llmArtifact: null,
    } as MessageItem

    const messageToSend = composer.trim()
    const usedSuggestion = selectedSuggestion
    setMessages((current) => [...current, optimisticMessage])
    setComposer("")
    setSelectedSuggestion(null)

    try {
      const res = await fetch(`/api/conversations/${selectedConversationId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: messageToSend,
          language: currentUser.role === "WORKER" ? "vi" : "ja",
        }),
      })

      if (!res.ok) {
        throw new Error("failed to send")
      }

      const data = await readJson<{ message: MessageItem }>(res)

      // 楽観的メッセージを実際のメッセージで置き換え
      setMessages((current) =>
        current.map((msg) => (msg.id === optimisticMessage.id ? data.message : msg))
      )

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

      // AI提案を使用した場合、ログを記録
      if (usedSuggestion) {
        const action =
          messageToSend === usedSuggestion.text ? "USED_AS_IS" : "USED_WITH_EDIT"

        fetch("/api/suggestions/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId: data.message.id,
            suggestionIndex: usedSuggestion.index,
            suggestionText: usedSuggestion.text,
            action,
            editedText: action === "USED_WITH_EDIT" ? messageToSend : undefined,
            modelUsed: "gemini-2.5-flash",
          }),
        }).catch((error) => console.error("Failed to log suggestion usage:", error))
      }
    } catch (error) {
      console.error(error)
      setSendError("メッセージの送信に失敗しました。")

      // エラー時は楽観的メッセージを削除
      setMessages((current) =>
        current.filter((msg) => msg.id !== optimisticMessage.id)
      )
      // メッセージを復元
      setComposer(messageToSend)
    } finally {
      setSending(false)
    }
  }

  function handleRemoveTag(conversationId: string, tag: ConversationTag) {
    if (tag.kind === "manual") {
      setCustomTags((previous) => {
        const current = previous[conversationId] ?? []
        if (!current.length) return previous
        const next = current.filter((item) => item.toLowerCase() !== tag.label.toLowerCase())
        return { ...previous, [conversationId]: next }
      })

      // Log manual tag removal
      fetch("/api/tags/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consultationCaseId: conversationId,
          tagLabel: tag.label,
          action: "REMOVED",
          tagSource: "manual",
        }),
      }).catch((error) => console.error("Failed to log tag change:", error))

      return
    }

    setRemovedTags((previous) => {
      const current = previous[conversationId] ?? []
      if (current.includes(tag.id)) return previous

      // Log AI-generated tag removal
      fetch("/api/tags/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consultationCaseId: conversationId,
          tagLabel: tag.label,
          action: "REMOVED",
          tagSource: "ai",
        }),
      }).catch((error) => console.error("Failed to log tag change:", error))

      return { ...previous, [conversationId]: [...current, tag.id] }
    })
  }

  function handleAddCustomTag(conversationId: string, label: string) {
    const trimmed = label.trim()
    if (!trimmed) return
    setCustomTags((previous) => {
      const current = previous[conversationId] ?? []
      if (current.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
        return previous
      }

      // Log manual tag addition
      fetch("/api/tags/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consultationCaseId: conversationId,
          tagLabel: trimmed,
          action: "ADDED",
          tagSource: "manual",
        }),
      }).catch((error) => console.error("Failed to log tag change:", error))

      return { ...previous, [conversationId]: [...current, trimmed] }
    })
  }

  async function handleRegenerateSuggestions() {
    if (!selectedConversationId) return
    setRegeneratingSuggestions(true)
    setRegenerateError(null)
    try {
      const res = await fetch(`/api/conversations/${selectedConversationId}/suggestions`, {
        method: "POST",
        cache: "no-store",
      })

      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({}))
        throw new Error(errorPayload.error ?? "Failed to regenerate suggestions")
      }

      const data = await readJson<{ message: MessageItem }>(res)

      // メッセージが存在する場合は更新、存在しない場合は初回提案として保存
      const messageExists = messages.some((message) => message.id === data.message.id)
      if (messageExists) {
        setMessages((current) =>
          current.map((message) => (message.id === data.message.id ? data.message : message)),
        )
      } else if (selectedConversationId) {
        // 初回メッセージの場合は初回提案に保存
        setInitialSuggestions((prev) => ({
          ...prev,
          [selectedConversationId]: data.message.llmArtifact?.suggestions ?? [],
        }))
      }
    } catch (error) {
      console.error(error)
      setRegenerateError("AI返信の生成に失敗しました。時間をおいて再実行してください。")
    } finally {
      setRegeneratingSuggestions(false)
    }
  }

  async function handleGenerateSegments() {
    if (!selectedConversationId) return
    setGeneratingSegments(true)
    try {
      const res = await fetch(`/api/conversations/${selectedConversationId}/segments`, {
        method: "POST",
        cache: "no-store",
      })
      if (res.ok) {
        const data = await res.json() as { segments: ConversationSegment[] }
        setSegments(data.segments ?? [])
      } else {
        console.error("Failed to generate segments")
      }
    } catch (error) {
      console.error("Failed to generate segments", error)
    } finally {
      setGeneratingSegments(false)
    }
  }

  async function handleSaveNotes(notes: string) {
    if (!selectedConversation?.worker?.id) return
    setSavingNotes(true)
    try {
      const res = await fetch(`/api/users/${selectedConversation.worker.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      })
      if (!res.ok) {
        throw new Error("Failed to save notes")
      }
      // 成功したら、selectedConversationを更新
      setSelectedConversation(prev => {
        if (!prev) return prev
        return {
          ...prev,
          worker: {
            ...prev.worker,
            notes,
          },
        }
      })
    } catch (error) {
      console.error("Failed to save notes", error)
    } finally {
      setSavingNotes(false)
    }
  }

  return (
    <div
      className="flex min-h-0 flex-1 overflow-y-auto bg-[#f4f7fb] lg:h-[100dvh] lg:overflow-hidden"
      style={{ minHeight: "100dvh" }}
    >
      <AppSidebar />

      <section className="grid flex-1 min-h-0 grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)_420px] xl:grid-cols-[320px_minmax(0,1fr)_560px] 2xl:grid-cols-[320px_minmax(0,1fr)_720px]">
        <div className="flex h-full min-h-0 flex-col border-b border-r bg-white md:border-b-0">
          <div className="px-4 pb-4 pt-6">
            <p className="text-lg font-semibold">チャット一覧</p>
            <p className="mt-1 text-xs text-muted-foreground">全ての担当者とすぐにチャットできます。</p>
            <Input
              className="mt-3 bg-slate-100"
              placeholder="チャットを検索する..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
          <div className="space-y-2 overflow-y-auto px-2 pb-6">
            {filteredConversations.length === 0 ? (
              <p className="px-4 text-sm text-muted-foreground">一致する相談者が見つかりません。</p>
            ) : (
              filteredConversations.map((conversation) => {
                const isActive = conversation.id === selectedConversationId
                const removed = removedTags[conversation.id] ?? []
                const manual = customTags[conversation.id] ?? []
                const tags = buildConversationTags(conversation, removed, manual)
                const isOnline = conversation.status === "IN_PROGRESS"
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => setSelectedConversationId(conversation.id)}
                    className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition ${
                      isActive ? "border-[#0F2C82] shadow-md" : "border-transparent hover:border-slate-200"
                    }`}
                  >
                    <ConversationListItem
                      conversation={conversation}
                      tags={tags}
                      isOnline={isOnline}
                    />
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="flex h-full min-h-0 flex-col overflow-hidden border-b border-r bg-white md:border-b-0">
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
            composerRef={composerRef}
            preferredLanguage={preferredLanguage}
          />
        </div>

        <ManagerInsightsPanel
          conversation={selectedConversation}
          consultation={consultation}
          suggestions={suggestionItems}
          onSelectSuggestion={(content, index) => {
            setComposer(content)
            setSelectedSuggestion({ text: content, index })
            composerRef.current?.focus()
          }}
          onFocusComposer={() => composerRef.current?.focus()}
          onRegenerateSuggestions={handleRegenerateSuggestions}
          regeneratingSuggestions={regeneratingSuggestions}
          regenerateError={regenerateError}
          tags={selectedConversationTags}
          onRemoveTag={(tag) => {
            if (!selectedConversationId) return
            handleRemoveTag(selectedConversationId, tag)
          }}
          onAddTag={() => {
            if (!selectedConversationId) return
            handleAddCustomTag(selectedConversationId, tagDraft)
            setTagDraft("")
          }}
          newTag={tagDraft}
          onNewTagChange={setTagDraft}
          contact={
            selectedConversation?.worker
              ? workerDirectory[selectedConversation.worker.id] ?? null
              : null
          }
          segments={segments}
          preferredLanguage={preferredLanguage}
          workerNotes={workerNotes}
          onNotesChange={setWorkerNotes}
          onSaveNotes={handleSaveNotes}
          savingNotes={savingNotes}
        />
      </section>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Worker layout (mobile friendly)
// -----------------------------------------------------------------------------

function WorkerChatDashboard({
  initialConversations,
  availableWorkers,
  currentUser,
  preferredLanguage,
}: DashboardViewProps) {
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
        const data = await readJson<{
          conversation: ConversationDetail & { messages: MessageItem[] }
        }>(res)
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
                  updatedAt: toIsoString(item.updatedAt),
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

      const data = await readJson<{
        conversation: ConversationDetail & { messages: MessageItem[] }
        summary: ConversationSummary
      }>(res)

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

      const data = await readJson<{ message: MessageItem }>(res)
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f4f7fb] lg:flex-row">
      <div className="flex min-h-0 w-full flex-col lg:h-full lg:max-w-[320px] lg:border-r lg:bg-white">
        <div className="flex w-full items-center justify-between bg-white px-4 py-4 lg:hidden">
          <div className="flex gap-3">
            <Button
              variant={mobileView === "list" ? "default" : "outline"}
              size="sm"
              onClick={() => setMobileView("list")}
              aria-pressed={mobileView === "list"}
            >
              一覧
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

        <div
          className={`bg-white ${
            mobileView === "chat" ? "hidden lg:block" : "flex-1"
          } lg:flex-1 lg:overflow-y-auto`}
        >
          <div className="px-4 pb-4 pt-6">
            <p className="text-lg font-semibold">チャット一覧</p>
            <Input
              className="mt-3 bg-slate-100"
              placeholder="チャットを検索"
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

      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-white ${
          mobileView === "list" ? "hidden lg:flex" : "flex"
        }`}
      >
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
            conversation={
              conversationDetail && selectedManager
                ? {
                    ...conversationDetail,
                    messages,
                    worker: {
                      id: selectedManager.id,
                      name: selectedManager.name,
                      locale: null,
                    },
                  }
                : null
            }
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
            preferredLanguage={preferredLanguage}
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
  messagesRef?: React.RefObject<HTMLDivElement | null>
  composerRef?: React.RefObject<HTMLTextAreaElement | null>
  preferredLanguage: string
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
  suggestions: _unusedSuggestions,
  consultation: _unusedConsultation,
  messagesRef,
  composerRef,
  preferredLanguage,
}: ChatViewProps) {
  const internalMessagesRef = useRef<HTMLDivElement | null>(null)
  const mergedRef = messagesRef ?? internalMessagesRef
  const internalComposerRef = useRef<HTMLTextAreaElement | null>(null)
  const textareaRef = composerRef ?? internalComposerRef
  void _unusedSuggestions
  void _unusedConsultation

  const messagePlaceholder = getMessagePlaceholder(preferredLanguage, conversation?.worker.locale)

  useEffect(() => {
    const container = mergedRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [mergedRef, messages, conversation?.id])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {conversation ? (
        <>
          <div className="border-b px-6 py-4">
            <p className="text-lg font-semibold">{conversation.worker.name ?? "相談"}</p>
            {conversation.worker.locale ? (
              <p className="text-xs text-muted-foreground">
                {[getLocaleLabel(conversation.worker.locale), conversation.group.name]
                  .filter(Boolean)
                  .join(" ・ ")}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{conversation.group.name}</p>
            )}
          </div>
          <div ref={mergedRef} className="flex-1 min-h-0 space-y-4 overflow-y-auto bg-slate-50 px-6 py-6">
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
                const isSystemMessage = message.type === "SYSTEM"
                const translation = message.llmArtifact?.translation?.trim()
                const medicalFacilities = message.metadata?.facilities || message.llmArtifact?.extra?.medicalFacilities
                const healthAnalysis = message.llmArtifact?.extra?.healthAnalysis
                const urls = extractUrls(message.body)

                // システムメッセージの場合
                if (isSystemMessage) {
                  return (
                    <div key={message.id} className="flex justify-center">
                      <div className="max-w-[85%] space-y-3">
                        <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
                          <div className="flex items-start gap-2">
                            <Bot className="h-5 w-5 shrink-0 text-blue-600 mt-0.5" />
                            <div className="flex-1">
                              <p className="text-sm text-blue-900">{message.body}</p>
                              <p className="mt-2 text-[10px] text-blue-600">
                                {new Date(message.createdAt).toLocaleTimeString("ja-JP", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* 医療機関カードの表示 */}
                        {medicalFacilities && medicalFacilities.length > 0 && (
                          <MedicalFacilitiesList
                            facilities={medicalFacilities}
                            title="近隣の医療機関"
                          />
                        )}
                      </div>
                    </div>
                  )
                }

                // 通常のメッセージ
                return (
                  <div key={message.id}>
                    <div className={`flex ${isWorker ? "justify-start" : "justify-end"}`}>
                      <div
                        className={`max-w-[75%] min-w-0 rounded-2xl px-4 py-3 shadow-sm ${
                          isWorker ? "bg-white" : "bg-[#0F2C82] text-white"
                        }`}
                      >
                        <div className="space-y-3">
                          <p
                            className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${
                              isWorker ? "text-slate-800" : "text-white"
                            }`}
                          >
                            {linkifyText(message.body)}
                          </p>
                          {translation ? (
                            <div
                              className={`border-t pt-3 text-sm leading-relaxed ${
                                isWorker
                                  ? "border-slate-300 text-slate-600"
                                  : "border-white/40 text-white/80"
                              }`}
                            >
                              <p className="whitespace-pre-wrap break-words">{linkifyText(translation)}</p>
                            </div>
                          ) : null}
                          {urls.map((url, index) => (
                            <UrlPreviewCard key={`${message.id}-url-${index}`} url={url} isWorker={isWorker} />
                          ))}
                        </div>
                        <p className={`mt-3 text-[10px] ${isWorker ? "text-slate-400" : "text-white/70"}`}>
                          {new Date(message.createdAt).toLocaleTimeString("ja-JP", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>

                    {/* 医療機関カードの表示 */}
                    {medicalFacilities && medicalFacilities.length > 0 && (
                      <div className="mt-3 flex justify-start">
                        <div className="max-w-[75%]">
                          <MedicalFacilitiesList
                            facilities={medicalFacilities}
                            title="近隣の医療機関"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
          <div className="border-t bg-white px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            <form onSubmit={onSend} className="space-y-3">
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
                <Textarea
                  placeholder={messagePlaceholder}
                  value={composer}
                  onChange={(event) => onComposerChange(event.target.value)}
                  rows={3}
                  ref={textareaRef}
                  className="flex-1 min-w-0"
                />
                <Button
                  type="submit"
                  disabled={sending || !composer.trim()}
                  className="w-full shrink-0 sm:w-28"
                >
                  {sending ? "送信中..." : "送信"}
                </Button>
              </div>
              {sendError ? <p className="text-xs text-destructive">{sendError}</p> : null}
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
  )
}

async function readJson<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") ?? ""
  const text = await res.text()

  if (!contentType.includes("application/json")) {
    throw new Error("予期しないレスポンス形式です")
  }

  if (!text.trim()) {
    throw new Error("サーバーから空のレスポンスが返されました")
  }

  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error("レスポンスの解析に失敗しました")
  }
}

type ManagerInsightsPanelProps = {
  conversation: (ConversationDetail & { messages: MessageItem[] }) | null
  consultation: ConsultationCase | (ConsultationCase & { description?: string | null }) | null
  suggestions: Array<{ content: string; tone?: string; language?: string; translation?: string; translationLang?: string }>
  onSelectSuggestion: (content: string, index: number) => void
  onFocusComposer: () => void
  onRegenerateSuggestions: () => void
  regeneratingSuggestions: boolean
  regenerateError: string | null
  tags: ConversationTag[]
  onRemoveTag: (tag: ConversationTag) => void
  onAddTag: () => void
  newTag: string
  onNewTagChange: (value: string) => void
  contact: WorkerOption | null
  segments: ConversationSegment[]
  preferredLanguage: string
  workerNotes: string
  onNotesChange: (value: string) => void
  onSaveNotes: (notes: string) => void
  savingNotes: boolean
}

function ManagerInsightsPanel({
  conversation,
  consultation,
  suggestions,
  onSelectSuggestion,
  onFocusComposer,
  onRegenerateSuggestions,
  regeneratingSuggestions,
  regenerateError,
  tags,
  onRemoveTag,
  onAddTag,
  newTag,
  onNewTagChange,
  contact,
  segments,
  preferredLanguage,
  workerNotes,
  onNotesChange,
  onSaveNotes,
  savingNotes,
}: ManagerInsightsPanelProps) {
  const toneLabelMap: Record<string, string> = {
    question: "質問",
    empathy: "共感",
    solution: "解決策",
    summary: "要約",
    "check-in": "チェックイン",
    "gentle-follow-up": "フォローアップ",
    continuation: "継続",
    encouragement: "励まし",
  }

  const statusLabel = conversation
    ? CASE_STATUS_LABEL[conversation.status as CaseStatus] ?? conversation.status
    : null
  const isOnline = conversation ? conversation.status === "IN_PROGRESS" : false
  const contactEmail = contact?.email ?? "未登録"
  const contactPhone = "未登録"
  const contactAddress = conversation ? conversation.group.name : "未登録"

  return (
    <aside className="hidden h-full min-h-0 w-full overflow-hidden border-l bg-[#f5f7ff] px-5 py-6 md:flex md:resize-x" style={{ minWidth: '320px', maxWidth: '80vw' }}>
      <div className="flex h-full w-full flex-col gap-6 xl:flex-row">
        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-800">AI返信</h2>
            {conversation ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                type="button"
                onClick={onRegenerateSuggestions}
                disabled={regeneratingSuggestions}
                aria-busy={regeneratingSuggestions}
              >
                <Bot className="h-4 w-4" />
                {regeneratingSuggestions ? "生成中..." : suggestions.length === 0 ? "生成" : "再生成"}
              </Button>
            ) : null}
          </div>
          <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
            {suggestions.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-xs text-muted-foreground mb-4">
                  {conversation ? "「生成」ボタンをクリックして初回メッセージを生成できます。" : "会話を選択してください。"}
                </p>
              </div>
            ) : (
              suggestions.map((suggestion, index) => {
                const toneKey = suggestion.tone ? suggestion.tone.toLowerCase() : ""
                const toneLabel = toneLabelMap[toneKey] ?? suggestion.tone ?? "提案"
                const { primary, secondary } = splitSuggestionContent(suggestion.content)
                return (
                  <button
                    key={`${suggestion.content}-${index}`}
                    type="button"
                    onClick={() => onSelectSuggestion(suggestion.content, index)}
                    className="w-full text-left"
                  >
                    <Card className="border border-slate-200 shadow-sm transition hover:border-[#0F2C82]/40 hover:shadow-md">
                      <CardContent className="space-y-2.5 px-4 py-3">
                        <div className="flex items-center text-xs text-muted-foreground">
                          <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[11px] font-medium">
                            {toneLabel}
                          </Badge>
                        </div>
                        <div className="space-y-2.5 text-sm leading-relaxed text-slate-700">
                          <p className="whitespace-pre-wrap">{primary}</p>
                          {secondary ? (
                            <div className="border-t border-slate-200 pt-2.5 text-slate-600">
                              <p className="whitespace-pre-wrap text-xs sm:text-sm">{secondary}</p>
                            </div>
                          ) : null}
                          {suggestion.translation ? (
                            <div className="border-t border-slate-200 pt-2.5 text-slate-600">
                              <p className="whitespace-pre-wrap text-xs leading-relaxed">{suggestion.translation}</p>
                            </div>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  </button>
                )
              })
            )}
          </div>
          {regenerateError ? <p className="mt-3 text-xs text-destructive">{regenerateError}</p> : null}
          <div className="mt-4 space-y-3">
            <Button type="button" variant="secondary" className="w-full" onClick={onFocusComposer}>
              自分で入力する
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              AI返信を選択するか、自分で入力して返信を作成してください。
            </p>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">ユーザー情報</h2>
        {conversation ? (
          <div className="mt-4 space-y-5 overflow-y-auto text-sm text-slate-700">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12">
                <AvatarFallback>{getInitials(conversation.worker.name)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold">{conversation.worker.name ?? "相談者"}</p>
                <p className="text-xs text-muted-foreground">
                  {[conversation.worker.locale ? getLocaleLabel(conversation.worker.locale) : null, conversation.group.name]
                    .filter(Boolean)
                    .join(" ・ ")}
                </p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="font-semibold text-slate-700">ステータス</p>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                <span
                  className={`inline-flex h-2 w-2 rounded-full ${isOnline ? "bg-emerald-500" : "bg-slate-300"}`}
                  aria-hidden
                />
                <span>{isOnline ? "オンライン" : "オフライン"}</span>
                {statusLabel ? <Badge variant="outline">{statusLabel}</Badge> : null}
                {consultation ? <Badge variant="secondary">{consultation.category}</Badge> : null}
                {consultation?.priority === "HIGH" ? (
                  <Badge className="bg-[#FF4D4F] text-white">緊急</Badge>
                ) : null}
              </div>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="font-semibold text-slate-700">相談タグ</p>
              {tags.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  {tags.map((tag) => (
                    <span key={`detail-${tag.id}`} className="inline-flex items-center">
                      <Badge
                        variant={tag.tone === "urgent" ? "destructive" : "secondary"}
                        className={
                          tag.tone === "urgent"
                            ? "bg-[#FF4D4F] text-white"
                            : "bg-slate-100 text-slate-700"
                        }
                      >
                        {tag.label}
                        <button
                          type="button"
                          onClick={() => onRemoveTag(tag)}
                          className={`ml-1 inline-flex items-center justify-center rounded-full p-0.5 ${
                            tag.tone === "urgent" ? "hover:bg-white/20" : "hover:bg-slate-200"
                          }`}
                          aria-label={`${tag.label} を削除`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">タグは現在ありません。</p>
              )}
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  onAddTag()
                }}
              >
                <Input
                  value={newTag}
                  onChange={(event) => onNewTagChange(event.target.value)}
                  placeholder="タグを追加"
                  className="h-9 flex-1 min-w-[140px]"
                />
                <Button type="submit" variant="outline" disabled={!newTag.trim()}>
                  追加
                </Button>
              </form>
            </div>

            {consultation?.summary ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-semibold text-slate-700">AI分析サマリー</p>
                <p className="rounded-xl bg-slate-50 p-3 text-[12px] text-slate-600">{consultation.summary}</p>
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

            {segments.length > 0 ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-semibold text-slate-700">過去の話題リスト</p>
                <div className="space-y-2">
                  {segments.map((segment, index) => (
                    <div
                      key={segment.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-3 transition hover:bg-slate-100"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-800">
                          {index + 1}. {segment.title}
                        </p>
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {segment.messageIds.length}件
                        </Badge>
                      </div>
                      {segment.summary ? (
                        <p className="mt-1 text-[11px] text-slate-600">{segment.summary}</p>
                      ) : null}
                      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block h-1 w-1 rounded-full bg-slate-400" />
                          {new Date(segment.startedAt).toLocaleString("ja-JP", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span>〜</span>
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block h-1 w-1 rounded-full bg-slate-400" />
                          {new Date(segment.endedAt).toLocaleString("ja-JP", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="font-semibold text-slate-700">連絡先情報</p>
              <div className="rounded-xl bg-slate-50 p-3 text-[12px] text-slate-600">
                <p>電話: {contactPhone}</p>
                <p>メール: {contactEmail}</p>
                <p>住所: {contactAddress}</p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="font-semibold text-slate-700">備考</p>
              <Textarea
                placeholder="個別面談の内容などを入力..."
                className="min-h-[100px] text-sm"
                value={workerNotes}
                onChange={(e) => onNotesChange(e.target.value)}
                onBlur={() => onSaveNotes(workerNotes)}
                disabled={savingNotes}
              />
              <p className="text-[10px] text-muted-foreground">
                {savingNotes ? "保存中..." : "備考はAI返信のコンテキストとして使用されます。"}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-muted-foreground">
            相談者を選択すると、AI返信と相談者情報がここに表示されます。
          </div>
        )}
        </section>
      </div>
    </aside>
  )
}


function splitSuggestionContent(content: string) {
  const normalized = content.replace(/\r\n/g, "\n").trim()
  if (!normalized) {
    return { primary: "", secondary: "" }
  }

  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  if (blocks.length >= 2) {
    return { primary: blocks[0], secondary: blocks.slice(1).join("\n\n") }
  }

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean)
  if (lines.length >= 2) {
    return { primary: lines[0], secondary: lines.slice(1).join("\n") }
  }

  return { primary: normalized, secondary: "" }
}

const MESSAGE_PLACEHOLDERS: Record<string, string> = {
  ja: "メッセージを書く",
  vi: "Viết tin nhắn",
  en: "Write a message",
  id: "Tulis pesan",
  tl: "Mag-type ng mensahe",
  fil: "Mag-type ng mensahe",
}

function resolvePlaceholder(code: string | null | undefined) {
  if (!code) return null
  const normalized = code.toLowerCase()
  if (normalized.startsWith("vi")) return MESSAGE_PLACEHOLDERS.vi
  if (normalized.startsWith("en")) return MESSAGE_PLACEHOLDERS.en
  if (normalized.startsWith("id")) return MESSAGE_PLACEHOLDERS.id
  if (normalized.startsWith("tl") || normalized.startsWith("fil")) return MESSAGE_PLACEHOLDERS.tl
  if (normalized.startsWith("ja")) return MESSAGE_PLACEHOLDERS.ja
  return null
}

function getMessagePlaceholder(preferredLanguage: string, fallback?: string | null) {
  return (
    resolvePlaceholder(preferredLanguage) ??
    resolvePlaceholder(fallback) ??
    MESSAGE_PLACEHOLDERS[DEFAULT_LANGUAGE]
  )
}

type ConversationTag = {
  id: string
  label: string
  tone?: "default" | "urgent"
  kind: "auto" | "manual"
}

function buildConversationTags(
  conversation: ConversationSummary | (ConversationDetail & { messages: MessageItem[] }),
  removedIds: string[],
  manualLabels: string[],
): ConversationTag[] {
  const excluded = new Set(removedIds)
  const tags: ConversationTag[] = []
  const seen = new Set<string>()

  const pushTag = (tag: ConversationTag) => {
    if (excluded.has(tag.id) || seen.has(tag.id)) {
      return
    }
    seen.add(tag.id)
    tags.push(tag)
  }

  if (conversation.group?.name) {
    pushTag({ id: `group-${conversation.group.id}`, label: conversation.group.name, kind: "auto" })
  }

  const category = conversation.consultation?.category
  if (category) {
    pushTag({ id: `category-${category}`, label: category, kind: "auto" })
  }

  if (conversation.consultation?.priority === "HIGH") {
    pushTag({ id: `${conversation.id}-urgent`, label: "緊急", tone: "urgent", kind: "auto" })
  }

  manualLabels.forEach((label) => {
    const trimmed = label.trim()
    if (!trimmed) return
    const manualId = `manual-${trimmed.toLowerCase()}`
    pushTag({ id: manualId, label: trimmed, kind: "manual" })
  })

  return tags
}

function ConversationListItem({
  conversation,
  tags,
  isOnline,
}: {
  conversation: ConversationSummary
  tags: ConversationTag[]
  isOnline: boolean
}) {
  return (
    <div className="flex items-start gap-3">
      <Avatar className="h-10 w-10">
        <AvatarFallback>{getInitials(conversation.worker?.name)}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{conversation.worker?.name ?? "相談"}</p>
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground break-words">
              {conversation.lastMessage?.body ?? "まだメッセージがありません"}
            </p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatRelativeTime(conversation.updatedAt)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`inline-flex h-2 w-2 rounded-full ${
              isOnline ? "bg-emerald-500" : "bg-slate-300"
            }`}
            aria-hidden
          />
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge
                key={tag.id}
                variant={tag.tone === "urgent" ? "destructive" : "secondary"}
                className={
                  tag.tone === "urgent"
                    ? "bg-[#FF4D4F] text-white"
                    : "bg-slate-100 text-slate-700"
                }
              >
                {tag.label}
              </Badge>
            ))}
          </div>
        </div>
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

// URLプレビューカードコンポーネント
function UrlPreviewCard({ url, isWorker }: { url: string; isWorker: boolean }) {
  const [preview, setPreview] = useState<{
    title?: string
    description?: string
    image?: string
    domain?: string
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function fetchPreview() {
      try {
        // ドメイン情報を取得
        const urlObj = new URL(url)
        const domain = urlObj.hostname

        setPreview({ domain })
        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setError(true)
          setLoading(false)
        }
      }
    }

    void fetchPreview()

    return () => {
      cancelled = true
    }
  }, [url])

  if (loading || error || !preview) {
    return null
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`mt-3 block rounded-lg border ${
        isWorker
          ? "border-slate-200 bg-slate-50 hover:bg-slate-100"
          : "border-white/20 bg-white/10 hover:bg-white/20"
      } p-3 transition-colors`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <ExternalLink className={`h-4 w-4 shrink-0 ${isWorker ? "text-slate-600" : "text-white/80"}`} />
            <p
              className={`truncate text-sm font-medium ${
                isWorker ? "text-slate-900" : "text-white"
              }`}
            >
              {preview.domain ?? "リンク"}
            </p>
          </div>
          <p
            className={`mt-1 text-xs break-all ${
              isWorker ? "text-slate-500" : "text-white/70"
            }`}
          >
            {url}
          </p>
        </div>
      </div>
    </a>
  )
}
