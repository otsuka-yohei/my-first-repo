import { NextRequest, NextResponse } from "next/server"

import { auth } from "@/auth"
import {
  getConversationSegments,
  regenerateConversationSegments,
} from "@/server/services/segment"

interface RouteParams {
  params: { conversationId: string }
}

export async function GET(_: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const segments = await getConversationSegments({
      conversationId: params.conversationId,
      user: { id: session.user.id, role: session.user.role },
    })

    return NextResponse.json({ segments })
  } catch (error) {
    console.error("Failed to load segments", error)
    const message = error instanceof Error ? error.message : "Failed to load segments"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(_: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const segments = await regenerateConversationSegments({
      conversationId: params.conversationId,
      user: { id: session.user.id, role: session.user.role },
    })

    return NextResponse.json({ segments })
  } catch (error) {
    console.error("Failed to regenerate segments", error)
    const message = error instanceof Error ? error.message : "Failed to regenerate segments"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
