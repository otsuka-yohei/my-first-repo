import { NextRequest, NextResponse } from "next/server"

import { auth } from "@/auth"
import { generateConsultationTags } from "@/server/services/consultation"

interface RouteParams {
  params: Promise<{ conversationId: string }>
}

export async function POST(_: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { conversationId } = await params

  try {
    const result = await generateConsultationTags({
      conversationId,
      user: { id: session.user.id, role: session.user.role },
    })

    return NextResponse.json({ result })
  } catch (error) {
    console.error("Failed to generate consultation tags", error)
    const message = error instanceof Error ? error.message : "Failed to generate consultation tags"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
