import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { UserRole } from "@prisma/client"

import { auth } from "@/auth"
import { prisma } from "@/server/db"
import { AuthorizationError } from "@/server/auth/permissions"

const broadcastSchema = z.object({
  groupId: z.string(),
  message: z.string().min(1),
  recipientIds: z.array(z.string()),
})

/**
 * 一斉送信の実行
 */
export async function POST(req: NextRequest) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // 権限チェック: MANAGER以上のみ
  if (
    session.user.role !== UserRole.MANAGER &&
    session.user.role !== UserRole.AREA_MANAGER &&
    session.user.role !== UserRole.SYSTEM_ADMIN
  ) {
    return NextResponse.json(
      { error: "一斉送信を実行する権限がありません。" },
      { status: 403 }
    )
  }

  const json = await req.json()
  const parsed = broadcastSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.errors },
      { status: 400 }
    )
  }

  const { groupId, message, recipientIds } = parsed.data

  try {
    // グループの存在確認と権限チェック
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        memberships: {
          where: { userId: session.user.id },
        },
      },
    })

    if (!group) {
      return NextResponse.json(
        { error: "指定されたグループが見つかりません。" },
        { status: 404 }
      )
    }

    // SYSTEM_ADMIN以外は、自分が所属するグループにのみ送信可能
    if (
      session.user.role !== UserRole.SYSTEM_ADMIN &&
      group.memberships.length === 0
    ) {
      return NextResponse.json(
        { error: "このグループに一斉送信する権限がありません。" },
        { status: 403 }
      )
    }

    // 受信者が全員グループメンバーであることを確認
    const recipients = await prisma.user.findMany({
      where: {
        id: { in: recipientIds },
        role: UserRole.WORKER,
        isActive: true,
        memberships: {
          some: {
            groupId,
          },
        },
      },
    })

    if (recipients.length !== recipientIds.length) {
      return NextResponse.json(
        { error: "一部の受信者が無効または権限がありません。" },
        { status: 400 }
      )
    }

    // 各ワーカーに対してメッセージを送信
    const results = await Promise.allSettled(
      recipients.map(async (recipient) => {
        // 既存の会話を検索
        let conversation = await prisma.conversation.findFirst({
          where: {
            groupId,
            workerId: recipient.id,
            status: "ACTIVE",
          },
        })

        // 会話が存在しない場合は作成
        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: {
              groupId,
              workerId: recipient.id,
              subject: "一斉送信",
              status: "ACTIVE",
            },
          })
        }

        // メッセージを作成
        const createdMessage = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderId: session.user.id,
            body: message,
            language: session.user.locale || "ja",
            type: "TEXT",
          },
        })

        // 会話を更新
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { updatedAt: new Date() },
        })

        return {
          recipientId: recipient.id,
          recipientName: recipient.name,
          conversationId: conversation.id,
          messageId: createdMessage.id,
        }
      })
    )

    const successful = results.filter((r) => r.status === "fulfilled")
    const failed = results.filter((r) => r.status === "rejected")

    console.log(
      `[broadcast] Sent to ${successful.length}/${recipients.length} recipients in group ${groupId} by ${session.user.id}`
    )

    return NextResponse.json({
      success: true,
      sent: successful.length,
      failed: failed.length,
      total: recipients.length,
      results: successful.map((r) => (r as PromiseFulfilledResult<any>).value),
    })
  } catch (error) {
    console.error("Failed to broadcast message:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "一斉送信の実行に失敗しました。",
      },
      { status: 500 }
    )
  }
}
