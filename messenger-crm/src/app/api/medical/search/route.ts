import { NextRequest, NextResponse } from "next/server"
import { UserRole } from "@prisma/client"

import { auth } from "@/auth"
import { AuthorizationError } from "@/server/auth/permissions"
import { prisma } from "@/server/db"
import { searchMedicalFacilities } from "@/server/services/medical"

export async function POST(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { userId, symptomType, urgency } = body as {
      userId?: string
      symptomType?: string
      urgency?: "immediate" | "today" | "this_week" | "flexible"
    }

    // ユーザー情報を取得
    const targetUserId = userId || session.user.id
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        role: true,
        address: true,
      },
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // 権限チェック: 自分自身またはマネージャー以上
    if (
      session.user.id !== targetUserId &&
      session.user.role !== UserRole.MANAGER &&
      session.user.role !== UserRole.AREA_MANAGER &&
      session.user.role !== UserRole.SYSTEM_ADMIN
    ) {
      return NextResponse.json(
        { error: "他のユーザーの医療機関検索はできません" },
        { status: 403 }
      )
    }

    // 住所が登録されていない場合はエラー
    if (!user.address) {
      return NextResponse.json(
        { error: "住所が登録されていません。設定ページから住所を登録してください。" },
        { status: 400 }
      )
    }

    // 医療機関を検索
    const facilities = await searchMedicalFacilities({
      address: user.address,
      symptomType,
      urgency,
    })

    return NextResponse.json({ facilities })
  } catch (error) {
    console.error("[api] Medical search failed:", error)

    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "医療機関検索に失敗しました" },
      { status: 500 }
    )
  }
}
