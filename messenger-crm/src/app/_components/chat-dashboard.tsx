"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Bot, ExternalLink, MessageSquare, Settings, X, Paperclip, Image as ImageIcon } from "lucide-react"

import { getSocket } from "@/lib/socket"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
import { AppSidebar } from "./app-sidebar"
import { MedicalFacilitiesList, type MedicalFacility } from "./medical-facility-card"
import type { CasePriority, CaseStatus } from "@prisma/client"

type UserRole = "MEMBER" | "MANAGER" | "AREA_MANAGER" | "SYSTEM_ADMIN"

type MessageItem = {
  id: string
  body: string
  language: string
  type: "TEXT" | "IMAGE" | "FILE" | "SYSTEM"
  contentUrl?: string | null
  createdAt: string
  metadata?: {
    type?: string
    facilities?: MedicalFacility[]
    healthConsultationState?: string
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
  updatedAt?: string
  healthConsultationState?: string | null
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
    locale?: string | null
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
  if (props.currentUser.role === "MEMBER") {
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
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
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
  const [_loadingSegments, setLoadingSegments] = useState(false)
  const [_generatingSegments, setGeneratingSegments] = useState(false)
  const [initialSuggestions, setInitialSuggestions] = useState<Record<string, Array<{ content: string; tone?: string; language?: string; translation?: string; translationLang?: string }>>>({})
  const [workerNotes, setWorkerNotes] = useState("")
  const [savingNotes, setSavingNotes] = useState(false)
  const [complianceAlert, setComplianceAlert] = useState<{
    riskLevel: "high" | "medium"
    reason: string
  } | null>(null)
  const [checkingCompliance, setCheckingCompliance] = useState(false)
  const [bypassCompliance, setBypassCompliance] = useState(false)
  const [showNewMessageAlert, setShowNewMessageAlert] = useState(false)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const prevConversationIdRef = useRef<string | null>(null)
  const prevMessageCountRef = useRef<number>(0)
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
        if (selectedConversationId && selectedConversationId.startsWith("placeholder-")) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const selectedConversationTags = useMemo(() => {
    if (!selectedConversation) return []
    const removedForSelected = selectedConversationId ? removedTags[selectedConversationId] ?? [] : []
    const customForSelected = selectedConversationId ? customTags[selectedConversationId] ?? [] : []
    return buildConversationTags(selectedConversation, removedForSelected, customForSelected)
  }, [selectedConversation, selectedConversationId, removedTags, customTags])

  // 画像選択ハンドラー
  function handleImageSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    // ファイルサイズチェック（10MB）
    if (file.size > 10 * 1024 * 1024) {
      setSendError("ファイルサイズが大きすぎます（最大10MB）")
      return
    }

    // ファイルタイプチェック
    if (!file.type.startsWith("image/")) {
      setSendError("画像ファイルのみアップロード可能です")
      return
    }

    setSelectedImage(file)
    setSendError(null)

    // プレビュー用のURLを作成
    const reader = new FileReader()
    reader.onload = (e) => {
      setImagePreviewUrl(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  // 画像選択をクリア
  function handleClearImage() {
    setSelectedImage(null)
    setImagePreviewUrl(null)
    setSendError(null)
  }

  async function handleSendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // テキストまたは画像のいずれかが必要
    if (!selectedConversationId || (!composer.trim() && !selectedImage)) {
      return
    }

    // マネージャー以上の場合、コンプライアンスチェックを実行（バイパスフラグがない場合のみ）
    const ENABLE_COMPLIANCE_CHECK = true // コンプライアンスチェックを有効化

    if (ENABLE_COMPLIANCE_CHECK && currentUser.role !== "MEMBER" && !bypassCompliance) {
      setCheckingCompliance(true)
      try {
        const checkRes = await fetch("/api/compliance/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: composer.trim() }),
        })

        if (checkRes.ok) {
          const checkData = await checkRes.json() as {
            riskLevel: "none" | "medium" | "high"
            reason?: string
          }

          if (checkData.riskLevel === "high" || checkData.riskLevel === "medium") {
            setComplianceAlert({
              riskLevel: checkData.riskLevel,
              reason: checkData.reason ?? "コンプライアンスリスクが検出されました",
            })
            setCheckingCompliance(false)
            return
          }
        } else if (checkRes.status === 401) {
          console.warn("Compliance check: Authentication failed, skipping check")
          // 認証エラーの場合はチェックをスキップして送信を続行
        } else {
          console.error("Compliance check API returned error:", checkRes.status)
          // その他のAPIエラー時も送信を続行
        }
      } catch (error) {
        console.error("Failed to check compliance", error)
        // チェックに失敗した場合は続行
      } finally {
        setCheckingCompliance(false)
      }
    }

    // バイパスフラグをリセット
    setBypassCompliance(false)

    setSending(true)
    setSendError(null)

    let uploadedImageUrl: string | null = null

    // 画像がある場合は先にアップロード
    if (selectedImage) {
      setUploadingImage(true)
      try {
        const formData = new FormData()
        formData.append("file", selectedImage)

        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        })

        if (!uploadRes.ok) {
          const errorData = await uploadRes.json().catch(() => ({}))
          throw new Error(errorData.error ?? "画像のアップロードに失敗しました")
        }

        const uploadData = await uploadRes.json() as { url: string }
        uploadedImageUrl = uploadData.url
      } catch (error) {
        console.error("Failed to upload image:", error)
        setSendError(error instanceof Error ? error.message : "画像のアップロードに失敗しました")
        setSending(false)
        setUploadingImage(false)
        return
      } finally {
        setUploadingImage(false)
      }
    }

    // 楽観的UI更新：送信前に即座にメッセージを表示
    const optimisticMessage = {
      id: `temp-${Date.now()}`,
      conversationId: selectedConversationId,
      senderId: currentUser.id,
      body: composer.trim(),
      language: currentUser.role === "MEMBER" ? "vi" : "ja",
      type: uploadedImageUrl ? ("IMAGE" as const) : ("TEXT" as const),
      contentUrl: uploadedImageUrl,
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
    setSelectedImage(null)
    setImagePreviewUrl(null)

    try {
      const res = await fetch(`/api/conversations/${selectedConversationId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: messageToSend || "(画像)",
          language: currentUser.role === "MEMBER" ? "vi" : "ja",
          type: uploadedImageUrl ? "IMAGE" : "TEXT",
          contentUrl: uploadedImageUrl,
        }),
      })

      if (!res.ok) {
        throw new Error("failed to send")
      }

      const data = await readJson<{ message: MessageItem }>(res)

      // 楽観的メッセージを実際のメッセージで置き換え
      setMessages((current) => {
        // 重複チェック：実際のメッセージが既に存在する場合は楽観的メッセージのみ削除
        const hasRealMessage = current.some(m => m.id === data.message.id && m.id !== optimisticMessage.id)
        if (hasRealMessage) {
          console.log('[send] Real message already exists (from WebSocket), removing optimistic message')
          return current.filter(msg => msg.id !== optimisticMessage.id)
        }
        return current.map((msg) => (msg.id === optimisticMessage.id ? data.message : msg))
      })

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

      // WebSocketで翻訳とAI提案の完了を待つ（message-updatedイベントで自動的に更新される）
      console.log(`[send] Message sent successfully. ID: ${data.message.id}, waiting for WebSocket updates...`)

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

  function scrollToBottom() {
    const container = messagesRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
      setShowNewMessageAlert(false)
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

  const handleRegenerateSuggestions = useCallback(async () => {
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

      // 再生成後、会話全体を再読み込みして最新の状態を取得
      const refreshRes = await fetch(`/api/conversations/${selectedConversationId}/messages`, {
        method: "GET",
        cache: "no-store",
      })

      if (refreshRes.ok) {
        const refreshData = await readJson<{
          conversation: ConversationDetail & { messages: MessageItem[] }
        }>(refreshRes)
        setSelectedConversation(refreshData.conversation)
        setMessages(refreshData.conversation.messages ?? [])
      }
    } catch (error) {
      console.error(error)
      setRegenerateError("AI返信の生成に失敗しました。時間をおいて再実行してください。")
    } finally {
      setRegeneratingSuggestions(false)
    }
  }, [selectedConversationId, messages])

  async function _handleGenerateSegments() {
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

  // 自動スクロールロジック（システムメッセージと自分のメッセージは常にスクロール）
  useEffect(() => {
    const container = messagesRef.current
    if (!container) return

    // 会話が変更された場合は常に最下部にスクロール
    if (prevConversationIdRef.current !== selectedConversationId) {
      prevConversationIdRef.current = selectedConversationId
      prevMessageCountRef.current = messages.length
      container.scrollTop = container.scrollHeight
      setShowNewMessageAlert(false)
      return
    }

    // メッセージが追加されたかチェック
    const messageAdded = messages.length > prevMessageCountRef.current
    prevMessageCountRef.current = messages.length

    if (messageAdded) {
      // 新しいメッセージを確認
      const latestMessage = messages[messages.length - 1]

      // システムメッセージまたはユーザー自身のメッセージの場合は常にスクロール
      if (
        latestMessage?.type === "SYSTEM" ||
        latestMessage?.sender.id === currentUser.id
      ) {
        console.log("[scroll] Auto-scrolling for system or own message")
        container.scrollTop = container.scrollHeight
        setShowNewMessageAlert(false)
        return
      }

      // その他のメッセージの場合は、ユーザーが最下部付近にいる場合のみ自動スクロール
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
      if (isNearBottom) {
        container.scrollTop = container.scrollHeight
        setShowNewMessageAlert(false)
      } else {
        // 最下部にいない場合は新着メッセージアラートを表示
        console.log("[scroll] User not at bottom, showing new message alert")
        setShowNewMessageAlert(true)
      }
    }
  }, [messages, selectedConversationId, currentUser.id])

  // 手動スクロールで最下部に到達したらアラートを非表示
  useEffect(() => {
    const container = messagesRef.current
    if (!container) return

    const handleScroll = () => {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
      if (isNearBottom && showNewMessageAlert) {
        setShowNewMessageAlert(false)
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [showNewMessageAlert])

  // WebSocketリスナー（新しいメッセージの受信用と更新用）
  useEffect(() => {
    if (!selectedConversationId) return

    const socket = getSocket()

    // 会話ルームに参加
    socket.emit('join-conversation', selectedConversationId)

    // 新しいメッセージを受信
    const handleNewMessage = ({ message }: { conversationId: string; message: MessageItem }) => {
      console.log('[WebSocket] Received new message', message.id, 'metadata:', message.metadata)
      setMessages(prev => {
        // 重複チェック（楽観的UIで既に表示されている場合がある）
        if (prev.some(m => m.id === message.id)) {
          console.log('[WebSocket] Message already exists, skipping')
          return prev
        }
        return [...prev, message]
      })

      // メッセージのmetadataにhealthConsultationStateが含まれている場合、conversationも更新
      if (message.metadata?.healthConsultationState) {
        console.log('[WebSocket] Manager: Updating healthConsultationState:', message.metadata.healthConsultationState)
        setSelectedConversation(prev => {
          if (!prev) return prev
          return {
            ...prev,
            healthConsultationState: message.metadata.healthConsultationState!,
          }
        })
      }
    }

    // メッセージ更新を受信（翻訳やAI提案の完了時）
    const handleMessageUpdated = ({ message }: { conversationId: string; message: MessageItem }) => {
      console.log('[WebSocket] Received message update', message.id)
      setMessages(prev => {
        // 既存のメッセージを更新
        const index = prev.findIndex(m => m.id === message.id)
        if (index !== -1) {
          const updated = [...prev]
          updated[index] = message
          console.log('[WebSocket] Message updated with translation/suggestions')
          return updated
        }
        // メッセージが見つからない場合は追加（稀なケース）
        console.log('[WebSocket] Message not found, adding as new')
        return [...prev, message]
      })
    }

    // 会話状態更新を受信（健康相談状態のリセットなど）
    const handleConversationStateUpdated = ({ healthConsultationState }: { conversationId: string; healthConsultationState: string | null }) => {
      console.log('[WebSocket] Manager: Received conversation-state-updated, healthConsultationState:', healthConsultationState)
      setSelectedConversation(prev => {
        if (!prev) return prev
        return {
          ...prev,
          healthConsultationState: healthConsultationState,
        }
      })
    }

    socket.on('new-message', handleNewMessage)
    socket.on('message-updated', handleMessageUpdated)
    socket.on('conversation-state-updated', handleConversationStateUpdated)

    return () => {
      socket.emit('leave-conversation', selectedConversationId)
      socket.off('new-message', handleNewMessage)
      socket.off('message-updated', handleMessageUpdated)
      socket.off('conversation-state-updated', handleConversationStateUpdated)
    }
  }, [selectedConversationId])

  return (
    <div
      className="flex min-h-0 flex-1 overflow-y-auto bg-[#f4f7fb] lg:h-[100dvh] lg:overflow-hidden"
      style={{ minHeight: "100dvh" }}
    >
      <AppSidebar userRole={currentUser.role} />

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
            currentUser={currentUser}
            complianceAlert={complianceAlert}
            onClearComplianceAlert={() => setComplianceAlert(null)}
            onBypassCompliance={() => setBypassCompliance(true)}
            checkingCompliance={checkingCompliance}
            showNewMessageAlert={showNewMessageAlert}
            onScrollToBottom={scrollToBottom}
            imagePreviewUrl={imagePreviewUrl}
            selectedImage={selectedImage}
            uploadingImage={uploadingImage}
            onImageSelect={handleImageSelect}
            onClearImage={handleClearImage}
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
  availableGroups,
  availableWorkers: _availableWorkers,
  currentUser,
  preferredLanguage,
}: DashboardViewProps) {
  const router = useRouter()

  // グループごとに会話を整理
  // 既存の会話とメンバーグループの両方を含める
  const groupConversations = useMemo(() => {
    console.log(`[worker-chat] Building groupConversations. Initial conversations: ${initialConversations.length}, Available groups: ${availableGroups.length}`)
    const grouped = new Map<string, ConversationSummary>()

    // 既存の会話を追加
    for (const conv of initialConversations) {
      if (!grouped.has(conv.group.id)) {
        console.log(`[worker-chat] Adding existing conversation for group ${conv.group.id} (${conv.group.name})`)
        grouped.set(conv.group.id, conv)
      }
    }

    // メンバーグループで会話がまだないものを追加
    for (const group of availableGroups) {
      if (!grouped.has(group.id)) {
        console.log(`[worker-chat] Creating placeholder conversation for group ${group.id} (${group.name})`)
        // 仮のConversationSummaryを作成
        grouped.set(group.id, {
          id: `placeholder-${group.id}`,
          subject: null,
          status: "ACTIVE",
          updatedAt: new Date().toISOString(),
          group: { id: group.id, name: group.name },
          worker: { id: currentUser.id, name: currentUser.name ?? null },
          lastMessage: null,
          consultation: null,
        })
      }
    }

    const result = Array.from(grouped.values())
    console.log(`[worker-chat] Built ${result.length} group conversations:`, result.map(c => ({ id: c.id, groupName: c.group.name })))
    return result
  }, [initialConversations, availableGroups, currentUser.id, currentUser.name])

  const [conversations, setConversations] = useState(initialConversations)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<{ id: string; name: string } | null>(null)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [conversationDetail, setConversationDetail] = useState<ConversationDetail | null>(null)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [composer, setComposer] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [mobileView, setMobileView] = useState<"list" | "chat">("list")
  const [showNewMessageAlert, setShowNewMessageAlert] = useState(false)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const prevConversationIdRef = useRef<string | null>(null)
  const prevMessageCountRef = useRef<number>(0)

  useEffect(() => {
    setConversations(initialConversations)
  }, [initialConversations])

  useEffect(() => {
    console.log(`[worker-chat] groupConversations effect triggered. Length: ${groupConversations.length}, selectedGroupId: ${selectedGroupId}`)
    if (groupConversations.length === 0) {
      console.log(`[worker-chat] No group conversations, clearing selection`)
      setSelectedGroupId(null)
      setSelectedConversationId(null)
      setConversationDetail(null)
      setMessages([])
      return
    }

    if (!selectedGroupId && groupConversations.length > 0) {
      console.log(`[worker-chat] No group selected, auto-selecting first group:`, groupConversations[0].group)
      const firstGroup = groupConversations[0].group
      const firstConversation = groupConversations[0]

      // 直接stateを更新（handleSelectGroupを呼ばない）
      setSelectedGroup(firstGroup)
      setSelectedGroupId(firstGroup.id)
      setSelectedConversationId(firstConversation.id)
      setMobileView("chat")
      setError(null)
    }
  }, [groupConversations, selectedGroupId])

  useEffect(() => {
    console.log(`[worker-chat] selectedConversationId effect triggered. ID: ${selectedConversationId}`)
    if (!selectedConversationId) {
      console.log(`[worker-chat] No conversation selected, clearing state`)
      setConversationDetail(null)
      setMessages([])
      return
    }

    // プレースホルダーIDの場合は会話を読み込まない
    if (selectedConversationId.startsWith("placeholder-")) {
      console.log(`[worker-chat] Placeholder ID detected, not loading conversation`)
      setConversationDetail(null)
      setMessages([])
      setLoading(false)
      setError(null)
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
          // レスポンスボディからエラーメッセージを取得
          const errorData = await res.json().catch(() => ({ error: "不明なエラー" }))
          console.error("Failed to load conversation:", {
            status: res.status,
            statusText: res.statusText,
            conversationId: selectedConversationId,
            error: errorData,
          })

          // ステータスコードに応じたエラーメッセージ
          let errorMessage = "メッセージを読み込めませんでした。"
          if (res.status === 403) {
            errorMessage = errorData.error || "この会話を閲覧する権限がありません。"
          } else if (res.status === 404) {
            errorMessage = errorData.error || "会話が見つかりませんでした。"
          } else if (errorData.error) {
            errorMessage = errorData.error
          }

          throw new Error(errorMessage)
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
        console.error("loadConversation error:", err)
        if (!cancelled) {
          const errorMessage = err instanceof Error ? err.message : "メッセージを読み込めませんでした。"
          setError(errorMessage)
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
    if (!container) return

    // 会話が変更された場合は常に最下部にスクロール
    if (prevConversationIdRef.current !== selectedConversationId) {
      prevConversationIdRef.current = selectedConversationId
      prevMessageCountRef.current = messages.length
      container.scrollTop = container.scrollHeight
      setShowNewMessageAlert(false)
      return
    }

    // メッセージが追加されたかチェック
    const messageAdded = messages.length > prevMessageCountRef.current
    prevMessageCountRef.current = messages.length

    if (messageAdded) {
      // 新しいメッセージを確認
      const latestMessage = messages[messages.length - 1]

      // システムメッセージまたはユーザー自身のメッセージの場合は常にスクロール
      if (
        latestMessage?.type === "SYSTEM" ||
        latestMessage?.sender.id === currentUser.id
      ) {
        console.log("[scroll] Auto-scrolling for system or own message")
        container.scrollTop = container.scrollHeight
        setShowNewMessageAlert(false)
        return
      }

      // その他のメッセージの場合は、ユーザーが最下部付近にいる場合のみ自動スクロール
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
      if (isNearBottom) {
        container.scrollTop = container.scrollHeight
        setShowNewMessageAlert(false)
      } else {
        // 最下部にいない場合は新着メッセージアラートを表示
        console.log("[scroll] User not at bottom, showing new message alert")
        setShowNewMessageAlert(true)
      }
    }
  }, [messages, selectedConversationId, currentUser.id])

  // 手動スクロールで最下部に到達したらアラートを非表示
  useEffect(() => {
    const container = messagesRef.current
    if (!container) return

    const handleScroll = () => {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
      if (isNearBottom && showNewMessageAlert) {
        setShowNewMessageAlert(false)
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [showNewMessageAlert])

  // WebSocketリスナー（新しいメッセージの受信用と更新用）
  useEffect(() => {
    if (!selectedConversationId) return
    // プレースホルダーIDの場合はWebSocket接続しない
    if (selectedConversationId.startsWith("placeholder-")) return

    const socket = getSocket()

    // 会話ルームに参加
    socket.emit('join-conversation', selectedConversationId)

    // 新しいメッセージを受信
    const handleNewMessage = ({ message }: { conversationId: string; message: MessageItem }) => {
      console.log('[WebSocket] Received new message', message.id, 'metadata:', message.metadata)
      setMessages(prev => {
        // 重複チェック（楽観的UIで既に表示されている場合がある）
        if (prev.some(m => m.id === message.id)) {
          console.log('[WebSocket] Message already exists, skipping')
          return prev
        }
        return [...prev, message]
      })

      // メッセージのmetadataにhealthConsultationStateが含まれている場合、conversationも更新
      if (message.metadata?.healthConsultationState) {
        console.log('[WebSocket] Worker: Updating healthConsultationState:', message.metadata.healthConsultationState)
        setConversationDetail(prev => {
          if (!prev) return prev
          return {
            ...prev,
            healthConsultationState: message.metadata.healthConsultationState!,
          }
        })
      }
    }

    // メッセージ更新を受信（翻訳やAI提案の完了時）
    const handleMessageUpdated = ({ message }: { conversationId: string; message: MessageItem }) => {
      console.log('[WebSocket] Received message update', message.id)
      setMessages(prev => {
        // 既存のメッセージを更新
        const index = prev.findIndex(m => m.id === message.id)
        if (index !== -1) {
          const updated = [...prev]
          updated[index] = message
          console.log('[WebSocket] Message updated with translation/suggestions')
          return updated
        }
        // メッセージが見つからない場合は追加（稀なケース）
        console.log('[WebSocket] Message not found, adding as new')
        return [...prev, message]
      })
    }

    // 会話状態更新を受信（健康相談状態のリセットなど）
    const handleConversationStateUpdated = ({ healthConsultationState }: { conversationId: string; healthConsultationState: string | null }) => {
      console.log('[WebSocket] Worker: Received conversation-state-updated, healthConsultationState:', healthConsultationState)
      setConversationDetail(prev => {
        if (!prev) return prev
        return {
          ...prev,
          healthConsultationState: healthConsultationState,
        }
      })
    }

    socket.on('new-message', handleNewMessage)
    socket.on('message-updated', handleMessageUpdated)
    socket.on('conversation-state-updated', handleConversationStateUpdated)

    return () => {
      socket.emit('leave-conversation', selectedConversationId)
      socket.off('new-message', handleNewMessage)
      socket.off('message-updated', handleMessageUpdated)
      socket.off('conversation-state-updated', handleConversationStateUpdated)
    }
  }, [selectedConversationId])

  // 新着メッセージボタンクリック時のスクロール処理
  const scrollToBottom = () => {
    const container = messagesRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
      setShowNewMessageAlert(false)
    }
  }

  const filteredGroups = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return groupConversations
    return groupConversations.filter((conv) => {
      const target = conv.group.name.toLowerCase()
      return target.includes(term)
    })
  }, [groupConversations, searchTerm])

  // すべてのマネージャーのメッセージを表示（特定のマネージャーでフィルタしない）
  const displayMessages = useMemo(() => {
    return messages.filter(
      (message) =>
        message.sender.id === currentUser.id ||
        message.sender.role !== "MEMBER"
    )
  }, [messages, currentUser.id])

  async function ensureConversation(group: { id: string; name: string }) {
    const existing = conversations.find((conversation) => conversation.group.id === group.id)
    if (existing) {
      return existing
    }

    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          groupId: group.id,
          workerId: currentUser.id,
          subject: `${group.name}との相談`,
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

  async function handleSelectGroup(group: { id: string; name: string }) {
    console.log(`[worker-chat] handleSelectGroup called with group:`, group)
    setSelectedGroup(group)
    setSelectedGroupId(group.id)
    setError(null)

    // groupConversationsから該当する会話を探す（プレースホルダーを含む）
    const conversation = groupConversations.find((conv) => conv.group.id === group.id)
    console.log(`[worker-chat] Found conversation:`, conversation)

    if (conversation) {
      console.log(`[worker-chat] Setting conversation ID: ${conversation.id}`)
      setSelectedConversationId(conversation.id)
      setMobileView("chat")
    } else {
      // 見つからない場合はプレースホルダーIDを生成
      const placeholderId = `placeholder-${group.id}`
      console.log(`[worker-chat] Creating placeholder ID: ${placeholderId}`)
      setSelectedConversationId(placeholderId)
      setMobileView("chat")
    }
  }

  // 画像選択ハンドラー
  function handleImageSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    // ファイルサイズチェック（10MB）
    if (file.size > 10 * 1024 * 1024) {
      setSendError("ファイルサイズが大きすぎます（最大10MB）")
      return
    }

    // ファイルタイプチェック
    if (!file.type.startsWith("image/")) {
      setSendError("画像ファイルのみアップロード可能です")
      return
    }

    setSelectedImage(file)
    setSendError(null)

    // プレビュー用のURLを作成
    const reader = new FileReader()
    reader.onload = (e) => {
      setImagePreviewUrl(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  // 画像選択をクリア
  function handleClearImage() {
    setSelectedImage(null)
    setImagePreviewUrl(null)
    setSendError(null)
  }

  async function handleSendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // テキストまたは画像のいずれかが必要
    if (!selectedConversationId || (!composer.trim() && !selectedImage)) {
      return
    }

    // プレースホルダーIDの場合は会話を作成してから送信
    let conversationId = selectedConversationId
    if (selectedConversationId.startsWith("placeholder-") && selectedGroup) {
      const summary = await ensureConversation(selectedGroup)
      if (!summary) {
        setSendError("会話の作成に失敗しました。")
        return
      }
      conversationId = summary.id
      setSelectedConversationId(summary.id)
    }

    setSending(true)
    setSendError(null)

    let uploadedImageUrl: string | null = null

    // 画像がある場合は先にアップロード
    if (selectedImage) {
      setUploadingImage(true)
      try {
        const formData = new FormData()
        formData.append("file", selectedImage)

        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        })

        if (!uploadRes.ok) {
          const errorData = await uploadRes.json().catch(() => ({}))
          throw new Error(errorData.error ?? "画像のアップロードに失敗しました")
        }

        const uploadData = await uploadRes.json() as { url: string }
        uploadedImageUrl = uploadData.url
      } catch (error) {
        console.error("Failed to upload image:", error)
        setSendError(error instanceof Error ? error.message : "画像のアップロードに失敗しました")
        setSending(false)
        setUploadingImage(false)
        return
      } finally {
        setUploadingImage(false)
      }
    }

    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: composer.trim() || "(画像)",
          language: currentUser.locale || "vi",
          type: uploadedImageUrl ? "IMAGE" : "TEXT",
          contentUrl: uploadedImageUrl,
        }),
      })

      if (!res.ok) {
        throw new Error("failed to send")
      }

      const data = await readJson<{ message: MessageItem }>(res)
      setMessages((current) => {
        // 重複チェック（WebSocketで既に追加されている場合がある）
        if (current.some(m => m.id === data.message.id)) {
          console.log('[send-worker] Message already exists, skipping')
          return current
        }
        return [...current, data.message]
      })
      setComposer("")
      setSelectedImage(null)
      setImagePreviewUrl(null)
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                lastMessage: data.message,
                updatedAt: data.message.createdAt,
              }
            : conversation,
        ),
      )

      // WebSocketで翻訳とAI提案の完了を待つ（message-updatedイベントで自動的に更新される）
      console.log(`[send-worker] Message sent successfully. ID: ${data.message.id}, waiting for WebSocket updates...`)
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
            {filteredGroups.length === 0 ? (
              <p className="px-2 text-sm text-muted-foreground">表示できるグループがありません。</p>
            ) : (
              filteredGroups.map((conv) => {
                const isActive = conv.group.id === selectedGroupId
                const preview = conv.lastMessage?.body ?? "メッセージなし"
                const time = formatRelativeTime(conv.updatedAt)
                return (
                  <button
                    key={conv.group.id}
                    type="button"
                    onClick={() => void handleSelectGroup(conv.group)}
                    className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition ${
                      isActive ? "border-[#0F2C82] shadow-md" : "border-transparent hover:border-slate-200"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback>{getInitials(conv.group.name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold">{conv.group.name}</p>
                          <span className="text-xs text-muted-foreground">{time}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-1">{preview}</p>
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

        {selectedGroup ? (
          <ChatView
            conversation={
              conversationDetail
                ? {
                    ...conversationDetail,
                    messages,
                    worker: {
                      id: currentUser.id,
                      name: selectedGroup.name,
                      locale: currentUser.locale,
                    },
                  }
                : selectedConversationId?.startsWith("placeholder-")
                ? {
                    id: selectedConversationId,
                    subject: null,
                    status: "ACTIVE",
                    group: selectedGroup,
                    worker: {
                      id: currentUser.id,
                      name: selectedGroup.name,
                      locale: currentUser.locale,
                      notes: null,
                    },
                    consultation: null,
                    messages: [],
                    healthConsultationState: null,
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
            currentUser={currentUser}
            showNewMessageAlert={showNewMessageAlert}
            onScrollToBottom={scrollToBottom}
            imagePreviewUrl={imagePreviewUrl}
            selectedImage={selectedImage}
            uploadingImage={uploadingImage}
            onImageSelect={handleImageSelect}
            onClearImage={handleClearImage}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center bg-slate-50">
            <div className="text-center text-muted-foreground">
              <MessageSquare className="mx-auto mb-3 h-10 w-10" />
              <p className="text-sm">グループを選択してチャットを開始してください。</p>
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
  currentUser?: {
    id: string
    role: UserRole
    name?: string | null
  }
  complianceAlert?: {
    riskLevel: "high" | "medium"
    reason: string
  } | null
  onClearComplianceAlert?: () => void
  onBypassCompliance?: () => void
  checkingCompliance?: boolean
  showNewMessageAlert?: boolean
  onScrollToBottom?: () => void
  imagePreviewUrl?: string | null
  selectedImage?: File | null
  uploadingImage?: boolean
  onImageSelect?: (event: React.ChangeEvent<HTMLInputElement>) => void
  onClearImage?: () => void
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
  currentUser,
  complianceAlert,
  onClearComplianceAlert,
  onBypassCompliance,
  checkingCompliance,
  showNewMessageAlert,
  onScrollToBottom,
  imagePreviewUrl,
  selectedImage,
  uploadingImage,
  onImageSelect,
  onClearImage,
}: ChatViewProps) {
  const internalMessagesRef = useRef<HTMLDivElement | null>(null)
  const mergedRef = messagesRef ?? internalMessagesRef
  const internalComposerRef = useRef<HTMLTextAreaElement | null>(null)
  const textareaRef = composerRef ?? internalComposerRef
  void _unusedSuggestions
  void _unusedConsultation

  const messagePlaceholder = getMessagePlaceholder(preferredLanguage, conversation?.worker.locale)

  // 前回の会話IDを保存
  const prevConversationIdRef = useRef<string | null>(null)

  useEffect(() => {
    const container = mergedRef.current
    if (!container) return

    // 会話が変更された場合は常に最下部にスクロール
    if (prevConversationIdRef.current !== conversation?.id) {
      prevConversationIdRef.current = conversation?.id ?? null
      container.scrollTop = container.scrollHeight
      return
    }

    // 同じ会話でメッセージが追加された場合
    // ユーザーが最下部付近にいる場合のみ自動スクロール
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    if (isNearBottom) {
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

          {/* コンプライアンスアラートダイアログ */}
          {complianceAlert && onClearComplianceAlert && onBypassCompliance && (
            <AlertDialog open={true}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    {complianceAlert.riskLevel === "high" ? (
                      <span className="text-red-600">⚠️ 重大なコンプライアンスリスク</span>
                    ) : (
                      <span className="text-yellow-600">⚠️ コンプライアンスリスクの可能性</span>
                    )}
                  </AlertDialogTitle>
                  <AlertDialogDescription className="space-y-3">
                    <p className="text-sm text-slate-700">{complianceAlert.reason}</p>
                    {complianceAlert.riskLevel === "high" ? (
                      <p className="text-sm text-red-600 font-medium">
                        このメッセージの送信は推奨されません。内容を見直してください。
                      </p>
                    ) : (
                      <p className="text-sm text-yellow-600 font-medium">
                        このメッセージには注意が必要です。送信前に内容を確認してください。
                      </p>
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={onClearComplianceAlert}>
                    内容を修正する
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      onBypassCompliance()
                      onClearComplianceAlert()
                      // フォームを再送信（React合成イベント経由）
                      setTimeout(() => {
                        const form = document.querySelector('form') as HTMLFormElement
                        if (form) {
                          form.requestSubmit()
                        }
                      }, 100)
                    }}
                    className={complianceAlert.riskLevel === "high" ? "bg-red-600 hover:bg-red-700" : ""}
                  >
                    このまま送信する
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {/* メッセージエリアと新着通知ボタン */}
          <div className="relative flex-1 min-h-0">
            <div ref={mergedRef} className="h-full space-y-4 overflow-y-auto bg-slate-50 px-6 py-6">
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
              <>
                {messages.map((message, index) => {
                const isSystemMessage = message.type === "SYSTEM"
                const translation = message.llmArtifact?.translation?.trim()
                const medicalFacilities = message.metadata?.facilities || message.llmArtifact?.extra?.medicalFacilities
                const _healthAnalysis = message.llmArtifact?.extra?.healthAnalysis
                const urls = extractUrls(message.body)

                // システムメッセージの場合（マネージャーのメッセージスタイルで表示）
                if (isSystemMessage) {
                  // メッセージを翻訳マーカーで分割（日本語と翻訳を分ける）
                  const translationMarker = '\n\n---TRANSLATION---\n\n'
                  let japaneseText = message.body
                  let translationText = ''

                  // 翻訳マーカーが存在する場合、日本語と翻訳を分ける
                  if (message.body.includes(translationMarker)) {
                    const parts = message.body.split(translationMarker)
                    japaneseText = parts[0]
                    translationText = parts[1] || ''
                  }

                  const showYesNoButtons = message.metadata?.showYesNoButtons === true

                  // Yes/Noボタンのラベルをlocaleに応じて変更
                  const yesLabel = conversation?.worker.locale === 'vi' ? 'Có' : 'はい'
                  const noLabel = conversation?.worker.locale === 'vi' ? 'Không' : 'いいえ'

                  return (
                    <div key={`${message.id}-${index}`}>
                      {/* 送信者名表示 */}
                      <p className="mb-1 ml-12 text-xs text-slate-500">
                        システム
                      </p>
                      <div className="flex gap-2 justify-start">
                        {/* アイコン表示 */}
                        <Avatar className="h-8 w-8 shrink-0 border border-slate-300">
                          <AvatarFallback className="bg-blue-50 text-blue-600 text-xs font-semibold">
                            <Bot className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="max-w-[75%] min-w-0">
                          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                            <div className="space-y-3">
                              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">
                                {linkifyText(japaneseText)}
                              </p>
                              {translationText && (
                                <div className="border-t border-slate-300 pt-3 text-sm leading-relaxed text-slate-600">
                                  <p className="whitespace-pre-wrap break-words">
                                    {linkifyText(translationText)}
                                  </p>
                                </div>
                              )}
                            </div>
                            <p className="mt-2 text-[10px] text-slate-400">
                              {new Date(message.createdAt).toLocaleTimeString("ja-JP", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>

                          {/* Yes/Noボタン */}
                          {showYesNoButtons && (
                            <div className="mt-2 flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 bg-white hover:bg-green-50 border-green-500 text-green-700"
                                onClick={() => {
                                  onComposerChange("はい、病院に行きたいです")
                                  // 自動的に送信
                                  setTimeout(() => {
                                    const form = document.querySelector('form[data-message-form="true"]') as HTMLFormElement
                                    if (form) form.requestSubmit()
                                  }, 100)
                                }}
                              >
                                {yesLabel}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 bg-white hover:bg-red-50 border-red-500 text-red-700"
                                onClick={() => {
                                  onComposerChange("いいえ、大丈夫です")
                                  // 自動的に送信
                                  setTimeout(() => {
                                    const form = document.querySelector('form[data-message-form="true"]') as HTMLFormElement
                                    if (form) form.requestSubmit()
                                  }, 100)
                                }}
                              >
                                {noLabel}
                              </Button>
                            </div>
                          )}


                          {/* 医療機関カードの表示 */}
                          {medicalFacilities && medicalFacilities.length > 0 && (
                            <div className="mt-2">
                              <MedicalFacilitiesList
                                facilities={medicalFacilities}
                                title="近隣の医療機関"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                }

                // 通常のメッセージ
                // 自分のメッセージかどうかを判定（ログインしているユーザーのID）
                const isOwnMessage = currentUser && message.sender.id === currentUser.id
                // 自分のメッセージでない場合に送信者名を表示
                const showSenderName = !isOwnMessage

                return (
                  <div key={`${message.id}-${index}`}>
                    {/* LINE風の送信者名表示（相手のメッセージの場合） */}
                    {showSenderName && (
                      <p className="mb-1 ml-12 text-xs text-slate-500">
                        {message.sender.name ?? "担当者"}
                      </p>
                    )}
                    <div className={`flex gap-2 ${isOwnMessage ? "justify-end" : "justify-start"}`}>
                      {/* 相手のメッセージの場合のみアイコンを表示 */}
                      {!isOwnMessage && (
                        <Avatar className="h-8 w-8 shrink-0 border border-slate-300">
                          <AvatarFallback className="bg-white text-slate-700 text-xs font-semibold">
                            {getInitials(message.sender.name)}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div
                        className={`max-w-[75%] min-w-0 rounded-2xl px-4 py-3 shadow-sm ${
                          isOwnMessage ? "bg-[#0F2C82] text-white" : "bg-white"
                        }`}
                      >
                        <div className="space-y-3">
                          {message.type === "IMAGE" && message.contentUrl ? (
                            <div className="space-y-2">
                              <img
                                src={message.contentUrl}
                                alt="添付画像"
                                className="max-w-full rounded-lg"
                                style={{ maxHeight: "300px" }}
                              />
                              {message.body && message.body !== "(画像)" && (
                                <p
                                  className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${
                                    isOwnMessage ? "text-white" : "text-slate-800"
                                  }`}
                                >
                                  {linkifyText(message.body)}
                                </p>
                              )}
                            </div>
                          ) : (
                            <p
                              className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${
                                isOwnMessage ? "text-white" : "text-slate-800"
                              }`}
                            >
                              {linkifyText(message.body)}
                            </p>
                          )}
                          {translation ? (
                            <div
                              className={`border-t pt-3 text-sm leading-relaxed ${
                                isOwnMessage
                                  ? "border-white/40 text-white/80"
                                  : "border-slate-300 text-slate-600"
                              }`}
                            >
                              <p className="whitespace-pre-wrap break-words">{linkifyText(translation)}</p>
                            </div>
                          ) : null}
                          {urls.map((url, index) => (
                            <UrlPreviewCard key={`${message.id}-url-${index}`} url={url} isWorker={!isOwnMessage} />
                          ))}
                        </div>
                        <p className={`mt-3 text-[10px] ${isOwnMessage ? "text-white/70" : "text-slate-400"}`}>
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
                        {/* アイコンの幅を確保 */}
                        {!isOwnMessage && <div className="w-8 shrink-0" />}
                        <div className="max-w-[75%] ml-2">
                          <MedicalFacilitiesList
                            facilities={medicalFacilities}
                            title="近隣の医療機関"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

                {/* システムメッセージ生成中インジケータ */}
                {conversation?.healthConsultationState &&
                 conversation.healthConsultationState !== "COMPLETED" &&
                 !sending &&
                 messages.length > 0 &&
                 messages[messages.length - 1].type !== "SYSTEM" && (
                  <div>
                    <p className="mb-1 ml-12 text-xs text-slate-500">
                      システム
                    </p>
                    <div className="flex gap-2 justify-start">
                      <Avatar className="h-8 w-8 shrink-0 border border-slate-300">
                        <AvatarFallback className="bg-blue-50 text-blue-600 text-xs font-semibold">
                          <Bot className="h-4 w-4 animate-pulse" />
                        </AvatarFallback>
                      </Avatar>
                      <div className="max-w-[75%] min-w-0">
                        <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                          <p className="text-sm text-slate-600">メッセージを生成中です...</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 新着メッセージ通知ボタン */}
          {showNewMessageAlert && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <button
                onClick={onScrollToBottom}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg transition-colors"
              >
                <span className="text-sm font-medium">新着メッセージ</span>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 14l-7 7m0 0l-7-7m7 7V3"
                  />
                </svg>
              </button>
            </div>
          )}
        </div>

        <div className="border-t bg-white px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            {/* 健康相談フロー中のキャンセルボタン */}
            {conversation?.healthConsultationState && conversation.healthConsultationState !== "COMPLETED" && (
              <div className="mb-3 flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-amber-600" />
                  <p className="text-sm text-amber-800">
                    {conversation.worker.locale === 'vi'
                      ? 'Đang tư vấn y tế...'
                      : '医療相談中...'}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="bg-white hover:bg-red-50 border-red-300 text-red-700"
                  onClick={() => {
                    onComposerChange(conversation.worker.locale === 'vi'
                      ? 'Tôi muốn dừng tư vấn y tế'
                      : '医療相談を中止します')
                    setTimeout(() => {
                      const form = document.querySelector('form[data-message-form="true"]') as HTMLFormElement
                      if (form) form.requestSubmit()
                    }, 100)
                  }}
                >
                  {conversation.worker.locale === 'vi' ? 'Hủy' : 'キャンセル'}
                </Button>
              </div>
            )}
            <form onSubmit={onSend} className="space-y-3" data-compliance-bypass={!!complianceAlert ? "false" : "true"} data-message-form="true">
              {imagePreviewUrl && (
                <div className="relative inline-block">
                  <img
                    src={imagePreviewUrl}
                    alt="プレビュー"
                    className="max-h-32 rounded border"
                  />
                  <button
                    type="button"
                    onClick={onClearImage}
                    className="absolute -top-2 -right-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex flex-1 flex-col gap-2">
                  <Textarea
                    placeholder={messagePlaceholder}
                    value={composer}
                    onChange={(event) => onComposerChange(event.target.value)}
                    rows={3}
                    ref={textareaRef}
                    className="flex-1 min-w-0"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={onImageSelect}
                      className="hidden"
                      id="image-upload"
                    />
                    <label
                      htmlFor="image-upload"
                      className="flex items-center gap-1 cursor-pointer text-sm text-muted-foreground hover:text-foreground"
                    >
                      <Paperclip className="h-4 w-4" />
                      画像を添付
                    </label>
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={sending || uploadingImage || checkingCompliance || (!composer.trim() && !selectedImage)}
                  className="w-full shrink-0 sm:w-28"
                >
                  {uploadingImage ? "アップロード中..." : checkingCompliance ? "確認中..." : sending ? "送信中..." : "送信"}
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
  } catch (_error) {
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
  preferredLanguage: _preferredLanguage,
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
  const artifact = consultation?.llmArtifact

  return (
    <aside className="hidden h-full min-h-0 w-full overflow-hidden border-l bg-[#f5f7ff] px-5 py-6 md:flex md:resize-x" style={{ minWidth: '320px', maxWidth: '80vw' }}>
      <div className="flex h-full w-full flex-col gap-6 xl:flex-row">
        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-800">AI返信</h2>
            {conversation && !(artifact?.extra && typeof artifact.extra === 'object' && 'healthConsultationInProgress' in artifact.extra && artifact.extra.healthConsultationInProgress) ? (
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
                {artifact?.extra && typeof artifact.extra === 'object' && 'healthConsultationInProgress' in artifact.extra && artifact.extra.healthConsultationInProgress ? (
                  <>
                    <p className="text-xs text-muted-foreground mb-2">
                      🏥 健康相談対応中
                    </p>
                    <p className="text-xs text-muted-foreground">
                      システムが自動で対応しています。
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      必要に応じてマネージャーからもメッセージを送信できます。
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground mb-4">
                    {conversation ? "「生成」ボタンをクリックして初回メッセージを生成できます。" : "会話を選択してください。"}
                  </p>
                )}
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
      } catch (_err) {
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
