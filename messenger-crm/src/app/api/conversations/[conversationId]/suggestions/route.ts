import { NextRequest, NextResponse } from "next/server"

import { auth } from "@/auth"
import { regenerateMessageSuggestions } from "@/server/services/conversation"

type RouteParams = {
  params: Promise<{ conversationId: string }>
}

export async function POST(_: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { conversationId } = await params

  try {
    const message = await regenerateMessageSuggestions({
      conversationId,
      user: { id: session.user.id, role: session.user.role },
    })

    return NextResponse.json({ message })
  } catch (error) {
    console.error("Failed to regenerate suggestions", error)
    const message = error instanceof Error ? error.message : "Failed to regenerate suggestions"
    const status = message === "No worker message available for suggestions" ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
