import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { AuthorizationError } from "@/server/auth/permissions"
import { getUserProfile, updateUserProfile } from "@/server/services/user"

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  locale: z.enum(["ja", "vi", "en"]).optional(),
  avatarUrl: z.string().optional(),
})

type RouteParams = {
  params: Promise<{ userId: string }>
}

/**
 * ユーザー情報取得
 */
export async function GET(_: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { userId } = await params

  try {
    const user = await getUserProfile(
      { id: session.user.id, role: session.user.role },
      userId,
    )

    return NextResponse.json({ user })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Failed to get user profile", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get user profile" },
      { status: 500 },
    )
  }
}

/**
 * ユーザープロフィール更新
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { userId } = await params
  const json = await req.json()
  const parsed = patchSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.errors },
      { status: 400 },
    )
  }

  try {
    const user = await updateUserProfile(
      { id: session.user.id, role: session.user.role },
      userId,
      parsed.data,
    )

    return NextResponse.json({ user })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Failed to update user profile", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update user profile" },
      { status: 500 },
    )
  }
}
