import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { AuthorizationError } from "@/server/auth/permissions"
import { updateGroup, softDeleteGroup, restoreGroup, migrateGroupData } from "@/server/services/group"

const updateGroupSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
})

const migrateGroupSchema = z.object({
  toGroupId: z.string().min(1, "移行先グループIDは必須です"),
  migrateConversations: z.boolean().default(true),
  migrateMembers: z.boolean().default(true),
})

type RouteParams = {
  params: Promise<{ groupId: string }>
}

/**
 * グループ更新（システム管理者のみ）
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { groupId } = await params

  try {
    const json = await req.json()
    const parsed = updateGroupSchema.safeParse(json)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "入力データが不正です", details: parsed.error.errors },
        { status: 400 },
      )
    }

    const group = await updateGroup({
      user: { id: session.user.id, role: session.user.role },
      groupId,
      name: parsed.data.name,
      description: parsed.data.description,
    })

    return NextResponse.json({ group })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Failed to update group", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update group" },
      { status: 500 },
    )
  }
}

/**
 * グループ論理削除（システム管理者のみ）
 */
export async function DELETE(_: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { groupId } = await params

  try {
    await softDeleteGroup({
      user: { id: session.user.id, role: session.user.role },
      groupId,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Failed to delete group", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete group" },
      { status: 500 },
    )
  }
}

/**
 * グループ復元（システム管理者のみ）
 */
export async function PUT(_: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { groupId } = await params

  try {
    const group = await restoreGroup({
      user: { id: session.user.id, role: session.user.role },
      groupId,
    })

    return NextResponse.json({ group })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Failed to restore group", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to restore group" },
      { status: 500 },
    )
  }
}

/**
 * グループデータ移行（システム管理者のみ）
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { groupId } = await params

  try {
    const json = await req.json()
    const parsed = migrateGroupSchema.safeParse(json)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "入力データが不正です", details: parsed.error.errors },
        { status: 400 },
      )
    }

    const result = await migrateGroupData({
      user: { id: session.user.id, role: session.user.role },
      fromGroupId: groupId,
      toGroupId: parsed.data.toGroupId,
      migrateConversations: parsed.data.migrateConversations,
      migrateMembers: parsed.data.migrateMembers,
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Failed to migrate group data", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to migrate group data" },
      { status: 500 },
    )
  }
}
