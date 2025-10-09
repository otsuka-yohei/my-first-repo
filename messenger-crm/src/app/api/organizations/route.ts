import { NextResponse } from "next/server"

import { auth } from "@/auth"
import { AuthorizationError } from "@/server/auth/permissions"
import { listOrganizations } from "@/server/services/group"

/**
 * 組織一覧取得（システム管理者のみ）
 */
export async function GET() {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const organizations = await listOrganizations({
      id: session.user.id,
      role: session.user.role,
    })

    return NextResponse.json({ organizations })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Failed to list organizations", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list organizations" },
      { status: 500 },
    )
  }
}
