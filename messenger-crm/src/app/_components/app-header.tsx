"use client"

import { useState } from "react"
import { signOut, useSession } from "next-auth/react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

type UserRole = "WORKER" | "MANAGER" | "AREA_MANAGER" | "SYSTEM_ADMIN"

type AppHeaderProps = {
  currentUser: {
    id: string
    role: UserRole
    name: string | null
    email: string | null
  }
}

const ROLE_LABEL: Record<UserRole, string> = {
  WORKER: "ユーザー",
  MANAGER: "一般管理者",
  AREA_MANAGER: "エリアマネージャー",
  SYSTEM_ADMIN: "システム管理者",
}

export function AppHeader({ currentUser }: AppHeaderProps) {
  const { data: session } = useSession()
  const [signingOut, setSigningOut] = useState(false)

  const displayName = session?.user?.name ?? currentUser.name ?? "ユーザー"
  const email = session?.user?.email ?? currentUser.email ?? ""
  const role = (session?.user?.role ?? currentUser.role) as UserRole

  async function handleSignOut() {
    try {
      setSigningOut(true)
      await signOut({ redirectTo: "/login" })
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <header className="flex items-center justify-between border-b bg-background px-6 py-4">
      <div>
        <p className="text-lg font-semibold">Messenger CRM</p>
        <p className="text-sm text-muted-foreground">多言語相談を一元管理</p>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <div className="text-right">
          <p className="font-medium">{displayName}</p>
          <p className="text-xs text-muted-foreground">{email}</p>
        </div>
        <Separator orientation="vertical" className="h-8" />
        <div className="text-right">
          <p className="text-xs text-muted-foreground">ロール</p>
          <p className="font-medium">{ROLE_LABEL[role]}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleSignOut} disabled={signingOut}>
          {signingOut ? "サインアウト中" : "サインアウト"}
        </Button>
      </div>
    </header>
  )
}
