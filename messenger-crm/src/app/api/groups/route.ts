import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { AuthorizationError } from "@/server/auth/permissions"
import { listGroups, createGroup } from "@/server/services/group"

const createGroupSchema = z.object({
  name: z.string().min(1, "グループ名は必須です"),
  description: z.string().optional(),
  organizationId: z.string().min(1, "組織IDは必須です"),
})

/**
 * グループ一覧取得
 */
export async function GET(req: NextRequest) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const includeDeleted = searchParams.get("includeDeleted") === "true"

    const groups = await listGroups(
      { id: session.user.id, role: session.user.role },
      includeDeleted,
    )

    return NextResponse.json({ groups })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Failed to list groups", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list groups" },
      { status: 500 },
    )
  }
}

/**
 * グループ作成（システム管理者のみ）
 */
export async function POST(req: NextRequest) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const json = await req.json()
    const parsed = createGroupSchema.safeParse(json)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "入力データが不正です", details: parsed.error.errors },
        { status: 400 },
      )
    }

    const group = await createGroup({
      user: { id: session.user.id, role: session.user.role },
      name: parsed.data.name,
      description: parsed.data.description,
      organizationId: parsed.data.organizationId,
    })

    return NextResponse.json({ group }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Failed to create group", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create group" },
      { status: 500 },
    )
  }
}
