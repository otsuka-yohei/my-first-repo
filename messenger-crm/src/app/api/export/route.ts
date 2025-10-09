import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { AuthorizationError } from "@/server/auth/permissions"
import {
  exportAuditLogs,
  exportConversations,
  exportMessages,
  exportSuggestionLogs,
  exportTagChangeLogs,
  exportUsers,
} from "@/server/services/export"

const exportSchema = z.object({
  type: z.enum([
    "conversations",
    "messages",
    "users",
    "suggestion_logs",
    "tag_logs",
    "audit_logs",
  ]),
  conversationIds: z.array(z.string()).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

/**
 * データをCSV形式でエクスポート
 */
export async function POST(req: NextRequest) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const json = await req.json()
  const parsed = exportSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.errors },
      { status: 400 },
    )
  }

  const { type, conversationIds, startDate, endDate } = parsed.data

  try {
    let csv: string
    let filename: string

    const user = { id: session.user.id, role: session.user.role }

    const start = startDate ? new Date(startDate) : undefined
    const end = endDate ? new Date(endDate) : undefined

    switch (type) {
      case "conversations":
        csv = await exportConversations(user, conversationIds)
        filename = `conversations_${new Date().toISOString().split("T")[0]}.csv`
        break

      case "messages":
        csv = await exportMessages(user, conversationIds)
        filename = `messages_${new Date().toISOString().split("T")[0]}.csv`
        break

      case "users":
        csv = await exportUsers(user)
        filename = `users_${new Date().toISOString().split("T")[0]}.csv`
        break

      case "suggestion_logs":
        csv = await exportSuggestionLogs(user, start, end)
        filename = `suggestion_logs_${new Date().toISOString().split("T")[0]}.csv`
        break

      case "tag_logs":
        csv = await exportTagChangeLogs(user, start, end)
        filename = `tag_logs_${new Date().toISOString().split("T")[0]}.csv`
        break

      case "audit_logs":
        csv = await exportAuditLogs(user, start, end)
        filename = `audit_logs_${new Date().toISOString().split("T")[0]}.csv`
        break

      default:
        return NextResponse.json({ error: "Invalid export type" }, { status: 400 })
    }

    console.log(`[export] ${session.user.id} exported ${type}`)

    // CSVファイルとして返す
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Failed to export data", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to export data" },
      { status: 500 },
    )
  }
}
