"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { BarChart3, MessageSquare, Settings, Users, Send } from "lucide-react"

const NAV_ITEMS = [
  { id: "chat", href: "/", icon: MessageSquare, label: "相談" },
  { id: "users", href: "/users", icon: Users, label: "顧客" },
  { id: "broadcast", href: "/broadcast", icon: Send, label: "一斉送信" },
  { id: "reports", href: "/reports", icon: BarChart3, label: "レポート" },
  { id: "settings", href: "/settings", icon: Settings, label: "設定" },
]

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden h-full w-[88px] min-h-0 flex-col bg-[#0F2C82] text-white md:flex">
      <nav className="flex flex-1 flex-col items-center gap-8 py-10">
        {NAV_ITEMS.map((item) => {
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
