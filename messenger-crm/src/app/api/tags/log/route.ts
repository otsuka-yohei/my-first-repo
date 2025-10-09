import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { TagChangeAction } from "@prisma/client"

import { auth } from "@/auth"
import { prisma } from "@/server/db"

const logTagChangeSchema = z.object({
  consultationId: z.string(),
  action: z.nativeEnum(TagChangeAction),
  tagName: z.string(),
  previousValue: z.string().optional(),
  newValue: z.string().optional(),
  isAIGenerated: z.boolean().default(false),
})

/**
 * タグ変更をログに記録
 */
export async function POST(req: NextRequest) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const json = await req.json()
  const parsed = logTagChangeSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.errors },
      { status: 400 },
    )
  }

  try {
    const log = await prisma.tagChangeLog.create({
      data: {
        consultationId: parsed.data.consultationId,
        userId: session.user.id,
        action: parsed.data.action,
        tagName: parsed.data.tagName,
        previousValue: parsed.data.previousValue,
        newValue: parsed.data.newValue,
        isAIGenerated: parsed.data.isAIGenerated,
      },
    })

    console.log(
      `[tag-log] ${session.user.id} ${parsed.data.action} tag "${parsed.data.tagName}" for consultation ${parsed.data.consultationId}`,
    )

    return NextResponse.json({ log }, { status: 201 })
  } catch (error) {
    console.error("Failed to log tag change", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to log tag change" },
      { status: 500 },
    )
  }
}
