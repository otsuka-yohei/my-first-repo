/**
 * チャット関連の型定義
 */

import type { CasePriority, CaseStatus } from "@prisma/client"
import type { MedicalFacility } from "../medical-facility-card"

export type UserRole = "MEMBER" | "MANAGER" | "AREA_MANAGER" | "SYSTEM_ADMIN"

export type MessageItem = {
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
    showYesNoButtons?: boolean
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
    suggestions?: Array<{
      content: string
      tone?: string
      language?: string
      translation?: string
      translationLang?: string
    }>
    extra?: {
      healthAnalysis?: {
        isHealthRelated: boolean
        symptomType?: string
        urgency?: string
        needsMedicalFacility?: boolean
        suggestedQuestions?: string[]
      }
      medicalFacilities?: MedicalFacility[]
      imageAnalysis?: {
        description: string
        documentType?: string
        urgency?: string
        suggestedActions?: string[]
        extractedText?: string
      }
    }
  } | null
}

export type ConsultationCase = {
  id: string
  category: string
  summary: string | null
  description?: string | null
  status: CaseStatus
  priority: CasePriority
  llmArtifact?: {
    suggestions?: Array<{ content: string; tone?: string }>
    extra?: Record<string, unknown>
  } | null
}

export type ConversationSegment = {
  id: string
  title: string
  summary: string | null
  messageIds: string[]
  startedAt: string
  endedAt: string
}

export type ConversationSummary = {
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

export type ConversationDetail = {
  id: string
  subject: string | null
  status: string
  healthConsultationState?: string | null
  updatedAt?: string
  group: { id: string; name: string }
  worker: { id: string; name: string | null; locale?: string | null; notes?: string | null }
  messages: MessageItem[]
  consultation?: (ConsultationCase & { description?: string | null }) | null
}

export type GroupOption = {
  id: string
  name: string
}

export type WorkerOption = {
  id: string
  name: string | null
  locale?: string | null
  email?: string | null
  groupIds?: string[]
}

export type ConversationTag = {
  id: string
  label: string
  kind: "auto" | "manual"
  tone?: "urgent"
}

export type ChatDashboardProps = {
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

export type DashboardViewProps = ChatDashboardProps & {
  preferredLanguage: string
}

export type ChatViewProps = {
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

export type ManagerInsightsPanelProps = {
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

export type ConversationListItemProps = {
  conversation: ConversationSummary
  isSelected: boolean
  onClick: () => void
  onRemove?: () => void
}

export type UrlPreviewCardProps = {
  url: string
  isWorker: boolean
}
