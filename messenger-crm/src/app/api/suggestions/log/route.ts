import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { SuggestionAction } from "@prisma/client"

import { auth } from "@/auth"
import { prisma } from "@/server/db"

const logSuggestionSchema = z.object({
  messageId: z.string(),
  suggestionIndex: z.number(),
  suggestionText: z.string(),
  action: z.nativeEnum(SuggestionAction),
  originalText: z.string().optional(),
  editedText: z.string().optional(),
  prompt: z.string().optional(),
  modelUsed: z.string().optional(),
  tokensUsed: z.number().optional(),
  generationTimeMs: z.number().optional(),
})

/**
 * AI提案の使用状況をログに記録
 */
export async function POST(req: NextRequest) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const json = await req.json()
  const parsed = logSuggestionSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.errors },
      { status: 400 },
    )
  }

  try {
    const log = await prisma.suggestionUsageLog.create({
      data: {
        messageId: parsed.data.messageId,
        userId: session.user.id,
        suggestionIndex: parsed.data.suggestionIndex,
        suggestionText: parsed.data.suggestionText,
        action: parsed.data.action,
        originalText: parsed.data.originalText,
        editedText: parsed.data.editedText,
        prompt: parsed.data.prompt,
        modelUsed: parsed.data.modelUsed,
        tokensUsed: parsed.data.tokensUsed,
        generationTimeMs: parsed.data.generationTimeMs,
      },
    })

    console.log(
      `[suggestion-log] ${session.user.id} ${parsed.data.action} suggestion ${parsed.data.suggestionIndex} for message ${parsed.data.messageId}`,
    )

    return NextResponse.json({ log }, { status: 201 })
  } catch (error) {
    console.error("Failed to log suggestion usage", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to log suggestion usage" },
      { status: 500 },
    )
  }
}
