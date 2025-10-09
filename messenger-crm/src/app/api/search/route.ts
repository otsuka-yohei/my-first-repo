import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { search } from "@/server/services/search"

const searchSchema = z.object({
  query: z.string().min(1),
  searchMessages: z.boolean().optional(),
  searchUsers: z.boolean().optional(),
  searchTags: z.boolean().optional(),
  limit: z.number().min(1).max(100).optional(),
})

/**
 * 統合検索
 */
export async function POST(req: NextRequest) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const json = await req.json()
  const parsed = searchSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.errors },
      { status: 400 },
    )
  }

  try {
    const results = await search({ id: session.user.id, role: session.user.role }, parsed.data)

    return NextResponse.json(results)
  } catch (error) {
    console.error("Failed to search", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to search" },
      { status: 500 },
    )
  }
}
