import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { UserRole } from "@prisma/client"

import BroadcastClient from "./broadcast-client"
import { AppSidebar } from "@/app/_components/app-sidebar"
import { auth } from "@/auth"
import { prisma } from "@/server/db"

export const metadata: Metadata = {
  title: "一斉送信",
  description: "グループ単位でメッセージを一斉送信します",
}

export default async function BroadcastPage() {
  const session = await auth()

  if (!session?.user) {
    redirect("/signin")
  }

  // 権限チェック: MANAGER以上のみアクセス可能
  if (
    session.user.role !== UserRole.MANAGER &&
    session.user.role !== UserRole.AREA_MANAGER &&
    session.user.role !== UserRole.SYSTEM_ADMIN
  ) {
    redirect("/")
  }

  // マネージャーが所属するグループを取得
  let groups
  if (session.user.role === UserRole.SYSTEM_ADMIN) {
    // SYSTEM_ADMINは全グループを閲覧可能
    groups = await prisma.group.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        description: true,
      },
      orderBy: { name: "asc" },
    })
  } else {
    // MANAGER以下は自分が所属するグループのみ
    const memberships = await prisma.groupMembership.findMany({
      where: { userId: session.user.id },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
    })
    groups = memberships.map((m) => m.group).filter((g) => g)
  }

  return (
    <div className="flex h-screen bg-[#f4f7fb]">
      <AppSidebar userRole={session.user.role} />
      <main className="flex-1 overflow-y-auto">
        <BroadcastClient groups={groups} currentUserId={session.user.id} />
      </main>
    </div>
  )
}
