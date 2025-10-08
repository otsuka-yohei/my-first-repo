import { NextRequest, NextResponse } from "next/server"

import { auth } from "@/auth"
import {
  consultationUpdateSchema,
  getConsultationCase,
  upsertConsultationCase,
} from "@/server/services/consultation"

interface RouteParams {
  params: Promise<{ conversationId: string }>
}

export async function GET(_: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { conversationId } = await params

  try {
    const consultation = await getConsultationCase({
      conversationId,
      user: { id: session.user.id, role: session.user.role },
    })

    return NextResponse.json({ consultation })
  } catch (error) {
    console.error("Failed to load consultation", error)
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { conversationId } = await params
  const json = await req.json()
  const parsed = consultationUpdateSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  try {
    const consultation = await upsertConsultationCase({
      conversationId,
      user: { id: session.user.id, role: session.user.role },
      data: parsed.data,
    })

    return NextResponse.json({ consultation })
  } catch (error) {
    console.error("Failed to update consultation", error)
    return NextResponse.json({ error: "Unable to update consultation" }, { status: 400 })
  }
}
