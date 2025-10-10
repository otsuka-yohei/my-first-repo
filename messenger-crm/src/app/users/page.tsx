import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { UserRole } from "@prisma/client"

import { AppSidebar } from "@/app/_components/app-sidebar"
import { auth } from "@/auth"
import UsersClient from "./users-client"

export const metadata: Metadata = {
  title: "ユーザー管理",
  description: "ユーザー情報の登録・更新・削除を行います",
}

export default async function UsersPage() {
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

  return (
    <div className="flex h-screen bg-[#f4f7fb]">
      <AppSidebar userRole={session.user.role} />
      <main className="flex-1 overflow-y-auto">
        <UsersClient currentUser={{ id: session.user.id, role: session.user.role }} />
      </main>
    </div>
  )
}
