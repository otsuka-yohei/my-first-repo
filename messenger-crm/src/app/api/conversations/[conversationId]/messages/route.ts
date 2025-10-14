import { NextRequest, NextResponse } from "next/server"
import { MessageType } from "@prisma/client"
import { z } from "zod"

import { auth } from "@/auth"
import {
  appendMessage,
  getConversationWithMessages,
} from "@/server/services/conversation"
import { isAppError, formatErrorResponse, logError } from "@/server/errors"

const postSchema = z.object({
  body: z.string().min(1),
  language: z.string().min(1),
  type: z.nativeEnum(MessageType).optional(),
  contentUrl: z.string().optional().nullable(),
})

type RouteParams = {
  params: Promise<{ conversationId: string }>
}

export async function GET(_: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { conversationId } = await params

  try {
    const conversation = await getConversationWithMessages({
      conversationId,
      user: { id: session.user.id, role: session.user.role },
    })

    const messagesWithTranslation = conversation.messages.filter(m => m.llmArtifact?.translation).length
    console.log(`[API] GET /conversations/${conversationId}/messages - ${conversation.messages.length} messages, ${messagesWithTranslation} with translation`)

    return NextResponse.json({ conversation })
  } catch (error) {
    logError(error, `GET /conversations/${conversationId}/messages`)

    const errorResponse = formatErrorResponse(error)
    return NextResponse.json(
      { error: errorResponse.error },
      { status: errorResponse.statusCode }
    )
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { conversationId } = await params
  const json = await req.json()
  const parsed = postSchema.safeParse(json)

  if (!parsed.success) {
    console.error("[API] Validation failed:", {
      conversationId,
      receivedData: json,
      errors: parsed.error.errors,
    })
    return NextResponse.json({
      error: "Invalid payload",
      details: parsed.error.errors
    }, { status: 400 })
  }

  try {
    console.log(`[API] POST /conversations/${conversationId}/messages - User: ${session.user.id}, Body length: ${parsed.data.body.length}, ContentUrl: ${parsed.data.contentUrl || 'none'}`)

    const message = await appendMessage({
      conversationId,
      user: { id: session.user.id, role: session.user.role, locale: session.user.locale },
      body: parsed.data.body,
      language: parsed.data.language,
      type: parsed.data.type,
      contentUrl: parsed.data.contentUrl,
    })

    console.log(`[API] Message created successfully. ID: ${message.id}, Has llmArtifact: ${!!message.llmArtifact}`)

    // WebSocketでリアルタイム通知
    if (global.io) {
      global.io.to(`conversation-${conversationId}`).emit('new-message', {
        conversationId,
        message
      })
      console.log(`[WebSocket] Broadcasted new message to conversation-${conversationId}`)
    }

    return NextResponse.json({ message })
  } catch (error) {
    logError(error, `POST /conversations/${conversationId}/messages`)

    const errorResponse = formatErrorResponse(error)
    return NextResponse.json(
      { error: errorResponse.error },
      { status: errorResponse.statusCode }
    )
  }
}
