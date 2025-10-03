import { NextRequest, NextResponse } from "next/server"
import { MessageType } from "@prisma/client"
import { z } from "zod"

import { auth } from "@/auth"
import { createConversation, listConversationsForUser } from "@/server/services/conversation"

const postSchema = z.object({
  workerId: z.string().min(1),
  groupId: z.string().min(1),
  subject: z.string().max(120).optional(),
  initialMessage: z
    .object({
      body: z.string().min(1),
      language: z.string().min(1),
      type: z.nativeEnum(MessageType).optional(),
    })
    .optional(),
})

export async function GET() {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const conversations = await listConversationsForUser({
    id: session.user.id,
    role: session.user.role,
  })

  return NextResponse.json({ conversations })
}

export async function POST(req: NextRequest) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const json = await req.json()
  const parsed = postSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  try {
    const conversation = await createConversation({
      user: { id: session.user.id, role: session.user.role },
      groupId: parsed.data.groupId,
      workerId: parsed.data.workerId,
      subject: parsed.data.subject,
      initialMessage: parsed.data.initialMessage,
    })

    const lastMessage = conversation.messages.at(-1) ?? null

    const summary = {
      id: conversation.id,
      subject: conversation.subject,
      status: conversation.status,
      updatedAt: conversation.updatedAt,
      group: conversation.group,
      worker: conversation.worker,
      lastMessage,
      consultation: conversation.consultation,
    }

    return NextResponse.json({ conversation, summary }, { status: 201 })
  } catch (error) {
    console.error("Failed to create conversation", error)
    return NextResponse.json({ error: "Unable to create conversation" }, { status: 400 })
  }
}
