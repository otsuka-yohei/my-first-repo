import { UserRole } from "@prisma/client"

import { AuthorizationError } from "@/server/auth/permissions"
import { prisma } from "@/server/db"

interface SessionUser {
  id: string
  role: UserRole
}

export interface UpdateUserProfileParams {
  name?: string
  locale?: string
  avatarUrl?: string
}

/**
 * ユーザープロフィールを更新
 *
 * @param user - セッションユーザー情報
 * @param targetUserId - 更新対象のユーザーID
 * @param updates - 更新するフィールド
 * @returns 更新後のユーザー情報
 * @throws AuthorizationError - 権限がない場合
 */
export async function updateUserProfile(
  user: SessionUser,
  targetUserId: string,
  updates: UpdateUserProfileParams,
) {
  // 権限チェック: 自分自身または管理者のみ更新可能
  if (user.id !== targetUserId && user.role !== UserRole.SYSTEM_ADMIN) {
    throw new AuthorizationError("他のユーザーのプロフィールは更新できません。")
  }

  // バリデーション
  if (updates.name !== undefined) {
    const trimmedName = updates.name.trim()
    if (trimmedName.length === 0) {
      throw new Error("名前は必須です。")
    }
    if (trimmedName.length > 100) {
      throw new Error("名前は100文字以内で入力してください。")
    }
  }

  if (updates.locale !== undefined) {
    // サポートされている言語のみ許可
    const supportedLocales = ["ja", "vi", "en"]
    if (!supportedLocales.includes(updates.locale)) {
      throw new Error(`サポートされていない言語です: ${updates.locale}`)
    }
  }

  if (updates.avatarUrl !== undefined) {
    // アバターURLのバリデーション（空文字列の場合はnullにする）
    if (updates.avatarUrl.trim().length === 0) {
      updates.avatarUrl = undefined
    }
  }

  // 更新データの準備
  const updateData: Record<string, unknown> = {}

  if (updates.name !== undefined) {
    updateData.name = updates.name.trim()
  }

  if (updates.locale !== undefined) {
    updateData.locale = updates.locale
  }

  if (updates.avatarUrl !== undefined) {
    updateData.avatarUrl = updates.avatarUrl || null
  }

  // データベース更新
  const updatedUser = await prisma.user.update({
    where: { id: targetUserId },
    data: updateData,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      locale: true,
      avatarUrl: true,
      timeZone: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  console.log(`[user] Profile updated for user ${targetUserId}:`, Object.keys(updateData))

  return updatedUser
}

/**
 * ユーザー情報を取得
 *
 * @param user - セッションユーザー情報
 * @param targetUserId - 取得対象のユーザーID
 * @returns ユーザー情報
 * @throws AuthorizationError - 権限がない場合
 */
export async function getUserProfile(user: SessionUser, targetUserId: string) {
  // 権限チェック: 自分自身または管理者のみ閲覧可能
  if (user.id !== targetUserId && user.role !== UserRole.SYSTEM_ADMIN) {
    throw new AuthorizationError("他のユーザーの情報は閲覧できません。")
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      locale: true,
      avatarUrl: true,
      timeZone: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  if (!targetUser) {
    throw new Error("ユーザーが見つかりません。")
  }

  return targetUser
}
