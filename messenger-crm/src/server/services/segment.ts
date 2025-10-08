import { UserRole } from "@prisma/client"

import { prisma } from "@/server/db"
import { segmentConversation } from "@/server/llm/service"

import { ensureConversationAccess } from "./conversation"

interface SessionUser {
  id: string
  role: UserRole
}

export async function getConversationSegments(params: {
  user: SessionUser
  conversationId: string
}) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    select: {
      id: true,
      groupId: true,
      workerId: true,
      segments: {
        orderBy: { startedAt: "asc" },
      },
    },
  })

  if (!conversation) {
    throw new Error("Conversation not found")
  }

  await ensureConversationAccess(params.user, conversation)

  return conversation.segments
}

export async function regenerateConversationSegments(params: {
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
    return []
  }

  const messagesForLLM = conversation.messages.map((msg) => ({
    id: msg.id,
    body: msg.body,
    language: msg.language,
    senderRole: msg.sender.role,
    createdAt: msg.createdAt,
  }))

  try {
    const segments = await segmentConversation({ messages: messagesForLLM })

    await prisma.$transaction(async (tx) => {
      await tx.conversationSegment.deleteMany({
        where: { conversationId: params.conversationId },
      })

      await tx.conversationSegment.createMany({
        data: segments.map((segment) => ({
          conversationId: params.conversationId,
          title: segment.title,
          summary: segment.summary,
          messageIds: segment.messageIds,
          startedAt: segment.startedAt,
          endedAt: segment.endedAt,
        })),
      })
    })

    const createdSegments = await prisma.conversationSegment.findMany({
      where: { conversationId: params.conversationId },
      orderBy: { startedAt: "asc" },
    })

    return createdSegments
  } catch (error) {
    console.error("Failed to regenerate conversation segments", error)
    throw new Error("Failed to regenerate conversation segments")
  }
}
