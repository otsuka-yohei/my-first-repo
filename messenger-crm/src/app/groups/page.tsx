import { redirect } from "next/navigation"
import { UserRole } from "@prisma/client"

import { auth } from "@/auth"

import GroupsClient from "./groups-client"

export default async function GroupsPage() {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  // システム管理者のみアクセス可能
  if (session.user.role !== UserRole.SYSTEM_ADMIN) {
    redirect("/")
  }

  return <GroupsClient />
}
