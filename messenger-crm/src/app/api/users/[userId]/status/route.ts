import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { AuthorizationError } from "@/server/auth/permissions"
import { activateUser, deactivateUser } from "@/server/services/user"

const statusSchema = z.object({
  isActive: z.boolean(),
})

type RouteParams = {
  params: Promise<{ userId: string }>
}

/**
 * ユーザーの有効/無効を切り替え
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { userId } = await params
  const json = await req.json()
  const parsed = statusSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.errors },
      { status: 400 },
    )
  }

  try {
    const user = parsed.data.isActive
      ? await activateUser({ id: session.user.id, role: session.user.role }, userId)
      : await deactivateUser({ id: session.user.id, role: session.user.role }, userId)

    return NextResponse.json({ user })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Failed to update user status", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update user status" },
      { status: 500 },
    )
  }
}
