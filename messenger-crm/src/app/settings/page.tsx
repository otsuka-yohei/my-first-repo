import type { Metadata } from "next"
import { redirect } from "next/navigation"

import SettingsClient from "./settings-client"
import { AppSidebar } from "@/app/_components/app-sidebar"
import { auth } from "@/auth"

export const metadata: Metadata = {
  title: "個人設定",
  description: "表示名や表示言語、プロフィール画像を調整します",
}

export default async function SettingsPage() {
  const session = await auth()

  if (!session?.user) {
    redirect("/signin")
  }

  return (
    <div className="flex h-screen bg-[#f4f7fb]">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">
        <SettingsClient currentUser={session.user} />
      </main>
    </div>
  )
}
