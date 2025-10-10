import type { Metadata } from "next"
import { redirect } from "next/navigation"

import SettingsClient from "./settings-client"
import { AppSidebar } from "@/app/_components/app-sidebar"
import { auth } from "@/auth"
import { prisma } from "@/server/db"

export const metadata: Metadata = {
  title: "個人設定",
  description: "表示名や表示言語、プロフィール画像を調整します",
}

export default async function SettingsPage() {
  const session = await auth()

  if (!session?.user) {
    redirect("/signin")
  }

  // データベースから完全なユーザー情報を取得
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      locale: true,
      avatarUrl: true,
      countryOfOrigin: true,
      dateOfBirth: true,
      gender: true,
      address: true,
      phoneNumber: true,
      jobDescription: true,
      hireDate: true,
    },
  })

  if (!user) {
    redirect("/signin")
  }

  return (
    <div className="flex h-screen bg-[#f4f7fb]">
      <AppSidebar userRole={user.role} />
      <main className="flex-1 overflow-y-auto">
        <SettingsClient
          currentUser={{
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            locale: user.locale,
            avatarUrl: user.avatarUrl,
            countryOfOrigin: user.countryOfOrigin,
            dateOfBirth: user.dateOfBirth?.toISOString() ?? null,
            gender: user.gender,
            address: user.address,
            phoneNumber: user.phoneNumber,
            jobDescription: user.jobDescription,
            hireDate: user.hireDate?.toISOString() ?? null,
          }}
        />
      </main>
    </div>
  )
}
