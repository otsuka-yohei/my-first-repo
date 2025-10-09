import { NextResponse } from "next/server"

import { auth } from "@/auth"
import { AuthorizationError } from "@/server/auth/permissions"
import { listGroups } from "@/server/services/user"

/**
 * グループ一覧取得
 */
export async function GET() {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const groups = await listGroups({ id: session.user.id, role: session.user.role })

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
