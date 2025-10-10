"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { BarChart3, MessageSquare, Settings, Users, Send } from "lucide-react"

type UserRole = "MEMBER" | "MANAGER" | "AREA_MANAGER" | "SYSTEM_ADMIN"

type NavItem = {
  id: string
  href: string
  icon: typeof MessageSquare
  label: string
  minRole?: UserRole // この権限以上で表示
}

const NAV_ITEMS: NavItem[] = [
  { id: "chat", href: "/", icon: MessageSquare, label: "相談" },
  { id: "users", href: "/users", icon: Users, label: "顧客", minRole: "MANAGER" },
  { id: "broadcast", href: "/broadcast", icon: Send, label: "一斉送信", minRole: "MANAGER" },
  { id: "reports", href: "/reports", icon: BarChart3, label: "レポート", minRole: "MANAGER" },
  { id: "settings", href: "/settings", icon: Settings, label: "設定" },
]

const ROLE_HIERARCHY: Record<UserRole, number> = {
  MEMBER: 0,
  MANAGER: 1,
  AREA_MANAGER: 2,
  SYSTEM_ADMIN: 3,
}

function hasAccess(userRole: UserRole, minRole?: UserRole): boolean {
  if (!minRole) return true
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minRole]
}

type AppSidebarProps = {
  userRole: UserRole
}

export function AppSidebar({ userRole }: AppSidebarProps) {
  const pathname = usePathname()

  const visibleItems = NAV_ITEMS.filter((item) => hasAccess(userRole, item.minRole))

  return (
    <aside className="hidden h-full w-[88px] min-h-0 flex-col bg-[#0F2C82] text-white md:flex">
      <nav className="flex flex-1 flex-col items-center gap-8 py-10">
        {visibleItems.map((item) => {
          const active = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-label={item.label}
              className={`flex h-12 w-12 items-center justify-center rounded-2xl transition ${
                active ? "bg-white text-[#0F2C82]" : "text-white/70 hover:bg-white/15"
              }`}
            >
              <Icon className="h-5 w-5" />
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}

export { NAV_ITEMS }
