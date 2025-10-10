import { UserRole } from "@prisma/client"

import { AuthorizationError } from "@/server/auth/permissions"
import { prisma } from "@/server/db"

interface SessionUser {
  id: string
  role: UserRole
}

/**
 * CSVフォーマットにエスケープ
 */
function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }
  const str = String(value)
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * CSVを生成
 */
function generateCSV(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.map(escapeCSV).join(",")
  const dataLines = rows.map((row) => row.map(escapeCSV).join(","))
  return [headerLine, ...dataLines].join("\n")
}

/**
 * 会話履歴をCSVでエクスポート
 */
export async function exportConversations(user: SessionUser, conversationIds?: string[]) {
  // 権限チェック: MANAGER以上
  if (
    user.role !== UserRole.MANAGER &&
    user.role !== UserRole.AREA_MANAGER &&
    user.role !== UserRole.SYSTEM_ADMIN
  ) {
    throw new AuthorizationError("会話履歴をエクスポートする権限がありません。")
  }

  // アクセス可能なグループIDを取得
  let allowedGroupIds: string[] = []
  if (user.role !== UserRole.SYSTEM_ADMIN) {
    const memberships = await prisma.groupMembership.findMany({
      where: { userId: user.id },
      select: { groupId: true },
    })
    allowedGroupIds = memberships.map((m) => m.groupId)
  }

  // 会話を取得
  const conversations = await prisma.conversation.findMany({
    where: {
      ...(conversationIds ? { id: { in: conversationIds } } : {}),
      ...(user.role !== UserRole.SYSTEM_ADMIN ? { groupId: { in: allowedGroupIds } } : {}),
    },
    include: {
      worker: {
        select: { name: true, email: true },
      },
      group: {
        select: { name: true },
      },
      messages: {
        include: {
          sender: {
            select: { name: true },
          },
          llmArtifact: true,
        },
        orderBy: { createdAt: "asc" },
      },
      consultation: true,
    },
    orderBy: { createdAt: "desc" },
  })

  const headers = [
    "会話ID",
    "グループ名",
    "メンバー名",
    "メンバーメール",
    "ステータス",
    "件名",
    "作成日時",
    "更新日時",
    "メッセージ数",
    "カテゴリ",
    "優先度",
  ]

  const rows = conversations.map((conv) => [
    conv.id,
    conv.group.name,
    conv.worker.name,
    conv.worker.email,
    conv.status,
    conv.subject || "",
    conv.createdAt.toISOString(),
    conv.updatedAt.toISOString(),
    conv.messages.length,
    conv.consultation?.category || "",
    conv.consultation?.priority || "",
  ])

  return generateCSV(headers, rows)
}

/**
 * メッセージ詳細をCSVでエクスポート
 */
export async function exportMessages(user: SessionUser, conversationIds?: string[]) {
  // 権限チェック
  if (
    user.role !== UserRole.MANAGER &&
    user.role !== UserRole.AREA_MANAGER &&
    user.role !== UserRole.SYSTEM_ADMIN
  ) {
    throw new AuthorizationError("メッセージをエクスポートする権限がありません。")
  }

  // アクセス可能なグループIDを取得
  let allowedGroupIds: string[] = []
  if (user.role !== UserRole.SYSTEM_ADMIN) {
    const memberships = await prisma.groupMembership.findMany({
      where: { userId: user.id },
      select: { groupId: true },
    })
    allowedGroupIds = memberships.map((m) => m.groupId)
  }

  const messages = await prisma.message.findMany({
    where: {
      ...(conversationIds ? { conversationId: { in: conversationIds } } : {}),
      conversation: {
        ...(user.role !== UserRole.SYSTEM_ADMIN ? { groupId: { in: allowedGroupIds } } : {}),
      },
    },
    include: {
      sender: {
        select: { name: true, role: true },
      },
      conversation: {
        select: {
          id: true,
          worker: { select: { name: true } },
          group: { select: { name: true } },
        },
      },
      llmArtifact: true,
    },
    orderBy: { createdAt: "asc" },
  })

  const headers = [
    "メッセージID",
    "会話ID",
    "グループ名",
    "メンバー名",
    "送信者名",
    "送信者ロール",
    "本文",
    "言語",
    "タイプ",
    "翻訳",
    "送信日時",
  ]

  const rows = messages.map((msg) => [
    msg.id,
    msg.conversationId,
    msg.conversation.group.name,
    msg.conversation.worker.name,
    msg.sender.name,
    msg.sender.role,
    msg.body,
    msg.language,
    msg.type,
    msg.llmArtifact?.translation || "",
    msg.createdAt.toISOString(),
  ])

  return generateCSV(headers, rows)
}

/**
 * ユーザー一覧をCSVでエクスポート
 */
export async function exportUsers(user: SessionUser) {
  // 権限チェック: MANAGER以上
  if (
    user.role !== UserRole.MANAGER &&
    user.role !== UserRole.AREA_MANAGER &&
    user.role !== UserRole.SYSTEM_ADMIN
  ) {
    throw new AuthorizationError("ユーザー一覧をエクスポートする権限がありません。")
  }

  // アクセス可能なグループIDを取得
  let allowedGroupIds: string[] = []
  if (user.role !== UserRole.SYSTEM_ADMIN) {
    const memberships = await prisma.groupMembership.findMany({
      where: { userId: user.id },
      select: { groupId: true },
    })
    allowedGroupIds = memberships.map((m) => m.groupId)
  }

  const users = await prisma.user.findMany({
    where:
      user.role === UserRole.SYSTEM_ADMIN
        ? {}
        : {
            memberships: {
              some: { groupId: { in: allowedGroupIds } },
            },
          },
    include: {
      memberships: {
        include: {
          group: {
            select: { name: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  const headers = [
    "ユーザーID",
    "名前",
    "メールアドレス",
    "ロール",
    "言語設定",
    "有効/無効",
    "所属グループ",
    "作成日時",
    "更新日時",
  ]

  const rows = users.map((u) => [
    u.id,
    u.name,
    u.email,
    u.role,
    u.locale,
    u.isActive ? "有効" : "無効",
    u.memberships.map((m) => m.group.name).join("; "),
    u.createdAt.toISOString(),
    u.updatedAt.toISOString(),
  ])

  return generateCSV(headers, rows)
}

/**
 * AI提案使用ログをCSVでエクスポート
 */
export async function exportSuggestionLogs(
  user: SessionUser,
  startDate?: Date,
  endDate?: Date,
) {
  // 権限チェック: MANAGER以上
  if (
    user.role !== UserRole.MANAGER &&
    user.role !== UserRole.AREA_MANAGER &&
    user.role !== UserRole.SYSTEM_ADMIN
  ) {
    throw new AuthorizationError("AI提案ログをエクスポートする権限がありません。")
  }

  const logs = await prisma.suggestionUsageLog.findMany({
    where: {
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
    },
    include: {
      user: {
        select: { name: true, email: true },
      },
      message: {
        select: {
          conversationId: true,
          conversation: {
            select: {
              worker: { select: { name: true } },
              group: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  const headers = [
    "ログID",
    "ユーザー名",
    "ユーザーメール",
    "グループ名",
    "メンバー名",
    "会話ID",
    "メッセージID",
    "提案インデックス",
    "提案テキスト",
    "アクション",
    "元のテキスト",
    "編集後テキスト",
    "モデル名",
    "トークン数",
    "生成時間(ms)",
    "日時",
  ]

  const rows = logs.map((log) => [
    log.id,
    log.user.name,
    log.user.email,
    log.message.conversation.group.name,
    log.message.conversation.worker.name,
    log.message.conversationId,
    log.messageId,
    log.suggestionIndex,
    log.suggestionText,
    log.action,
    log.originalText || "",
    log.editedText || "",
    log.modelUsed || "",
    log.tokensUsed || "",
    log.generationTimeMs || "",
    log.createdAt.toISOString(),
  ])

  return generateCSV(headers, rows)
}

/**
 * タグ変更ログをCSVでエクスポート
 */
export async function exportTagChangeLogs(user: SessionUser, startDate?: Date, endDate?: Date) {
  // 権限チェック: MANAGER以上
  if (
    user.role !== UserRole.MANAGER &&
    user.role !== UserRole.AREA_MANAGER &&
    user.role !== UserRole.SYSTEM_ADMIN
  ) {
    throw new AuthorizationError("タグ変更ログをエクスポートする権限がありません。")
  }

  const logs = await prisma.tagChangeLog.findMany({
    where: {
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
    },
    include: {
      user: {
        select: { name: true, email: true },
      },
      consultation: {
        select: {
          conversationId: true,
          conversation: {
            select: {
              worker: { select: { name: true } },
              group: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  const headers = [
    "ログID",
    "ユーザー名",
    "ユーザーメール",
    "グループ名",
    "メンバー名",
    "相談ID",
    "会話ID",
    "アクション",
    "タグ名",
    "前の値",
    "新しい値",
    "AI生成",
    "日時",
  ]

  const rows = logs.map((log) => [
    log.id,
    log.user.name,
    log.user.email,
    log.consultation.conversation.group.name,
    log.consultation.conversation.worker.name,
    log.consultationId,
    log.consultation.conversationId,
    log.action,
    log.tagName,
    log.previousValue || "",
    log.newValue || "",
    log.isAIGenerated ? "はい" : "いいえ",
    log.createdAt.toISOString(),
  ])

  return generateCSV(headers, rows)
}

/**
 * 監査ログをCSVでエクスポート
 */
export async function exportAuditLogs(user: SessionUser, startDate?: Date, endDate?: Date) {
  // 権限チェック: AREA_MANAGER以上
  if (user.role !== UserRole.AREA_MANAGER && user.role !== UserRole.SYSTEM_ADMIN) {
    throw new AuthorizationError("監査ログをエクスポートする権限がありません。")
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
    },
    include: {
      actor: {
        select: { name: true, email: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10000, // 最大10000件
  })

  const headers = [
    "ログID",
    "アクター名",
    "アクターメール",
    "アクション",
    "エンティティタイプ",
    "エンティティID",
    "変更内容",
    "日時",
  ]

  const rows = logs.map((log) => [
    log.id,
    log.actor?.name || "システム",
    log.actor?.email || "",
    log.action,
    log.entityType,
    log.entityId,
    log.changes ? JSON.stringify(log.changes) : "",
    log.createdAt.toISOString(),
  ])

  return generateCSV(headers, rows)
}
