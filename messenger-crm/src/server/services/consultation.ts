import { CasePriority, CaseStatus, UserRole } from "@prisma/client"
import { z } from "zod"

import { AuthorizationError } from "@/server/auth/permissions"
import { prisma } from "@/server/db"
import { generateConversationTags } from "@/server/llm/service"

import { ensureConversationAccess } from "./conversation"

interface SessionUser {
  id: string
  role: UserRole
}

export const consultationUpdateSchema = z.object({
  category: z.string().max(120),
  summary: z.string().max(500).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.nativeEnum(CaseStatus),
  priority: z.nativeEnum(CasePriority),
})

export async function getConsultationCase(params: {
  user: SessionUser
  conversationId: string
}) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    select: {
      id: true,
      groupId: true,
      workerId: true,
      consultation: true,
    },
  })

  if (!conversation) {
    throw new Error("Conversation not found")
  }

  await ensureConversationAccess(params.user, conversation)

  if (!conversation.consultation) {
    return null
  }

  return conversation.consultation
}

export async function upsertConsultationCase(params: {
  user: SessionUser
  conversationId: string
  data: z.infer<typeof consultationUpdateSchema>
}) {
  if (params.user.role === UserRole.MEMBER) {
    throw new AuthorizationError("相談の更新権限がありません。")
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    select: {
      id: true,
      groupId: true,
      workerId: true,
    },
  })

  if (!conversation) {
    throw new Error("Conversation not found")
  }

  await ensureConversationAccess(params.user, conversation)

  const existing = await prisma.consultationCase.findUnique({
    where: { conversationId: params.conversationId },
  })

  const result = await prisma.consultationCase.upsert({
    where: { conversationId: params.conversationId },
    update: {
      category: params.data.category,
      summary: params.data.summary ?? null,
      description: params.data.description ?? null,
      status: params.data.status,
      priority: params.data.priority,
    },
    create: {
      conversationId: params.conversationId,
      category: params.data.category,
      summary: params.data.summary ?? null,
      description: params.data.description ?? null,
      status: params.data.status,
      priority: params.data.priority,
    },
  })

  await prisma.auditLog.create({
    data: {
      actorId: params.user.id,
      action: existing ? "consultation.update" : "consultation.create",
      entityType: "ConsultationCase",
      entityId: result.id,
      changes: {
        before: existing
          ? {
              category: existing.category,
              summary: existing.summary,
              description: existing.description,
              status: existing.status,
              priority: existing.priority,
            }
          : null,
        after: {
          category: result.category,
          summary: result.summary,
          description: result.description,
          status: result.status,
          priority: result.priority,
        },
      },
    },
  })

  return result
}

export async function generateConsultationTags(params: {
  user: SessionUser
  conversationId: string
}) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          sender: { select: { role: true } },
        },
      },
    },
  })

  if (!conversation) {
    throw new Error("Conversation not found")
  }

  await ensureConversationAccess(params.user, conversation)

  if (conversation.messages.length === 0) {
    return {
      category: "未分類",
      tags: [],
      summary: "メッセージがありません",
    }
  }

  const messagesForLLM = conversation.messages.map((msg) => ({
    body: msg.body,
    language: msg.language,
    senderRole: msg.sender.role,
    createdAt: msg.createdAt,
  }))

  try {
    const result = await generateConversationTags(messagesForLLM)
    return result
  } catch (error) {
    console.error("Failed to generate consultation tags", error)
    throw new Error("Failed to generate consultation tags")
  }
}
