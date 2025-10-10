import { NextRequest, NextResponse } from "next/server"
import { UserRole } from "@prisma/client"

import { auth } from "@/auth"
import { prisma } from "@/server/db"

type RouteParams = {
  params: Promise<{ groupId: string }>
}

/**
 * グループに所属するワーカー一覧を取得
 */
export async function GET(_: NextRequest, { params }: RouteParams) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // 権限チェック: MANAGER以上のみ
  if (
    session.user.role !== UserRole.MANAGER &&
    session.user.role !== UserRole.AREA_MANAGER &&
    session.user.role !== UserRole.SYSTEM_ADMIN
  ) {
    return NextResponse.json(
      { error: "ワーカー一覧を閲覧する権限がありません。" },
      { status: 403 }
    )
  }

  const { groupId } = await params

  try {
    // グループの存在確認と権限チェック
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        memberships: {
          where: { userId: session.user.id },
        },
      },
    })

    if (!group) {
      return NextResponse.json(
        { error: "指定されたグループが見つかりません。" },
        { status: 404 }
      )
    }

    // SYSTEM_ADMIN以外は、自分が所属するグループのみ閲覧可能
    if (
      session.user.role !== UserRole.SYSTEM_ADMIN &&
      group.memberships.length === 0
    ) {
      return NextResponse.json(
        { error: "このグループのワーカーを閲覧する権限がありません。" },
        { status: 403 }
      )
    }

    // グループに所属するワーカーを取得
    const workers = await prisma.user.findMany({
      where: {
        role: UserRole.MEMBER,
        isActive: true,
        memberships: {
          some: {
            groupId,
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        locale: true,
        countryOfOrigin: true,
        dateOfBirth: true,
        gender: true,
        address: true,
        phoneNumber: true,
        jobDescription: true,
        hireDate: true,
        createdAt: true,
      },
      orderBy: { name: "asc" },
    })

    return NextResponse.json({ workers })
  } catch (error) {
    console.error("Failed to get workers:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "ワーカー一覧の取得に失敗しました。",
      },
      { status: 500 }
    )
  }
}
