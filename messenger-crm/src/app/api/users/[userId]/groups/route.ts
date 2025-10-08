import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { AuthorizationError } from "@/server/auth/permissions"
import { updateUserGroups } from "@/server/services/user"

const updateGroupsSchema = z.object({
  groupIds: z.array(z.string()),
})

type RouteParams = {
  params: Promise<{ userId: string }>
}

/**
 * ユーザーのグループメンバーシップ更新
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { userId } = await params
  const json = await req.json()
  const parsed = updateGroupsSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.errors },
      { status: 400 },
    )
  }

  try {
    const user = await updateUserGroups(
      { id: session.user.id, role: session.user.role },
      userId,
      parsed.data,
    )

    return NextResponse.json({ user })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Failed to update user groups", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update user groups" },
      { status: 500 },
    )
  }
}
