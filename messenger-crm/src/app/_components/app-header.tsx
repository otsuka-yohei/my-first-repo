"use client"

import { useSession } from "next-auth/react"
import { useFormStatus } from "react-dom"

import { logoutAction } from "@/app/actions/logout"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

type UserRole = "MEMBER" | "MANAGER" | "AREA_MANAGER" | "SYSTEM_ADMIN"

type AppHeaderProps = {
  currentUser: {
    id: string
    role: UserRole
    name: string | null
    email: string | null
  }
}

const ROLE_LABEL: Record<UserRole, string> = {
  MEMBER: "ユーザー",
  MANAGER: "一般管理者",
  AREA_MANAGER: "エリアマネージャー",
  SYSTEM_ADMIN: "システム管理者",
}

export function AppHeader({ currentUser }: AppHeaderProps) {
  const { data: session } = useSession()

  const displayName = session?.user?.name ?? currentUser.name ?? "ユーザー"
  const email = session?.user?.email ?? currentUser.email ?? ""
  const role = (session?.user?.role ?? currentUser.role) as UserRole

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
        <form action={logoutAction} className="inline">
          <SignOutButton />
        </form>
      </div>
    </header>
  )
}

function SignOutButton() {
  const { pending } = useFormStatus()

  return (
    <Button variant="outline" size="sm" type="submit" disabled={pending}>
      {pending ? "サインアウト中" : "サインアウト"}
    </Button>
  )
}
