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

    return NextResponse.json({ conversation })
  } catch (error) {
    console.error("Failed to load conversation", error)
    return NextResponse.json({ error: "Not found" }, { status: 404 })
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
    const message = await appendMessage({
      conversationId,
      user: { id: session.user.id, role: session.user.role, locale: session.user.locale },
      body: parsed.data.body,
      language: parsed.data.language,
      type: parsed.data.type,
    })

    return NextResponse.json({ message })
  } catch (error) {
    console.error("Failed to append message", error)
    return NextResponse.json({ error: "Unable to send message" }, { status: 500 })
  }
}
