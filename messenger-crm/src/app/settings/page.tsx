import type { Metadata } from "next"

import SettingsClient from "./settings-client"
import { AppSidebar } from "@/app/_components/app-sidebar"

export const metadata: Metadata = {
  title: "個人設定",
  description: "表示名や表示言語、プロフィール画像を調整します",
}

export default function SettingsPage() {
  return (
    <div className="flex h-screen bg-[#f4f7fb]">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">
        <SettingsClient />
      </main>
    </div>
  )
}
