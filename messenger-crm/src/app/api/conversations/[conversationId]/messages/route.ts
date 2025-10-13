import { NextRequest, NextResponse } from "next/server"
import { MessageType } from "@prisma/client"
import { z } from "zod"

import { auth } from "@/auth"
import {
  appendMessage,
  getConversationWithMessages,
} from "@/server/services/conversation"

const postSchema = z.object({
  body: z.string().min(1),
  language: z.string().min(1),
  type: z.nativeEnum(MessageType).optional(),
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
    console.error("Failed to load conversation:", {
      conversationId,
      userId: session.user.id,
      userRole: session.user.role,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    // エラーの種類に応じて適切なステータスコードとメッセージを返す
    if (error instanceof Error) {
      if (error.message === "Conversation not found") {
        return NextResponse.json(
          { error: "会話が見つかりませんでした" },
          { status: 404 }
        )
      }
      if (error.message.includes("権限がありません") || error.message.includes("閲覧できません")) {
        return NextResponse.json(
          { error: error.message },
          { status: 403 }
        )
      }
    }

    return NextResponse.json(
      { error: "会話の読み込みに失敗しました" },
      { status: 500 }
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
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  try {
    console.log(`[API] POST /conversations/${conversationId}/messages - User: ${session.user.id}, Body length: ${parsed.data.body.length}`)

    const message = await appendMessage({
      conversationId,
      user: { id: session.user.id, role: session.user.role, locale: session.user.locale },
      body: parsed.data.body,
      language: parsed.data.language,
      type: parsed.data.type,
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
    console.error("Failed to append message", error)
    return NextResponse.json({ error: "Unable to send message" }, { status: 500 })
  }
}
