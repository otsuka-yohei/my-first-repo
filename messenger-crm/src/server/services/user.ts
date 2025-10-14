import { MembershipRole, UserRole } from "@prisma/client"
import bcrypt from "bcryptjs"

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
  countryOfOrigin?: string | null
  dateOfBirth?: string | null
  gender?: string | null
  address?: string | null
  phoneNumber?: string | null
  jobDescription?: string | null
  hireDate?: string | null
  notes?: string | null
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
  // 権限チェック
  // 1. 自分自身のプロフィールは常に更新可能
  // 2. SYSTEM_ADMINは全員のプロフィールを更新可能
  // 3. MANAGER/AREA_MANAGERは、自分が管理するグループのメンバーのプロフィールを更新可能
  if (user.id !== targetUserId) {
    if (user.role === UserRole.SYSTEM_ADMIN) {
      // SYSTEM_ADMINは全員のプロフィールを更新可能
    } else if (user.role === UserRole.MANAGER || user.role === UserRole.AREA_MANAGER) {
      // マネージャーの場合、対象ユーザーが同じグループに所属しているか確認
      const userMemberships = await prisma.groupMembership.findMany({
        where: { userId: user.id },
        select: { groupId: true },
      })
      const managerGroupIds = userMemberships.map((m) => m.groupId)

      const targetMemberships = await prisma.groupMembership.findMany({
        where: { userId: targetUserId },
        select: { groupId: true },
      })
      const targetGroupIds = targetMemberships.map((m) => m.groupId)

      const hasCommonGroup = managerGroupIds.some((gid) => targetGroupIds.includes(gid))
      if (!hasCommonGroup) {
        throw new AuthorizationError("このユーザーのプロフィールを更新する権限がありません。")
      }
    } else {
      throw new AuthorizationError("他のユーザーのプロフィールは更新できません。")
    }
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

  if (updates.countryOfOrigin !== undefined) {
    updateData.countryOfOrigin = updates.countryOfOrigin?.trim() || null
  }

  if (updates.dateOfBirth !== undefined) {
    updateData.dateOfBirth = updates.dateOfBirth ? new Date(updates.dateOfBirth) : null
  }

  if (updates.gender !== undefined) {
    updateData.gender = updates.gender?.trim() || null
  }

  if (updates.address !== undefined) {
    updateData.address = updates.address?.trim() || null
  }

  if (updates.phoneNumber !== undefined) {
    updateData.phoneNumber = updates.phoneNumber?.trim() || null
  }

  if (updates.jobDescription !== undefined) {
    updateData.jobDescription = updates.jobDescription?.trim() || null
  }

  if (updates.hireDate !== undefined) {
    updateData.hireDate = updates.hireDate ? new Date(updates.hireDate) : null
  }

  if (updates.notes !== undefined) {
    updateData.notes = updates.notes?.trim() || null
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
      countryOfOrigin: true,
      dateOfBirth: true,
      gender: true,
      address: true,
      phoneNumber: true,
      jobDescription: true,
      hireDate: true,
      notes: true,
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
      countryOfOrigin: true,
      dateOfBirth: true,
      gender: true,
      address: true,
      phoneNumber: true,
      jobDescription: true,
      hireDate: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  if (!targetUser) {
    throw new Error("ユーザーが見つかりません。")
  }

  return targetUser
}

/**
 * ユーザー一覧を取得
 *
 * @param user - セッションユーザー情報
 * @returns ユーザー一覧（グループ情報含む）
 * @throws AuthorizationError - 権限がない場合
 */
export async function listUsers(user: SessionUser) {
  // 権限チェック: MANAGER以上のみ閲覧可能
  if (
    user.role !== UserRole.MANAGER &&
    user.role !== UserRole.AREA_MANAGER &&
    user.role !== UserRole.SYSTEM_ADMIN
  ) {
    throw new AuthorizationError("ユーザー一覧を閲覧する権限がありません。")
  }

  // SYSTEM_ADMINは全ユーザーを閲覧可能
  if (user.role === UserRole.SYSTEM_ADMIN) {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        locale: true,
        avatarUrl: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        memberships: {
          include: {
            group: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    return users
  }

  // MANAGERとAREA_MANAGERは自分が所属するグループのユーザーのみ閲覧可能
  const userMemberships = await prisma.groupMembership.findMany({
    where: { userId: user.id },
    select: { groupId: true },
  })

  const groupIds = userMemberships.map((m) => m.groupId)

  if (groupIds.length === 0) {
    return []
  }

  const users = await prisma.user.findMany({
    where: {
      memberships: {
        some: {
          groupId: { in: groupIds },
        },
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      locale: true,
      avatarUrl: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      memberships: {
        where: {
          groupId: { in: groupIds },
        },
        include: {
          group: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return users
}

export interface CreateUserParams {
  email: string
  password: string
  name: string
  role: UserRole
  groupIds: string[]
  locale?: string
  countryOfOrigin?: string
  dateOfBirth?: string
  gender?: string
  address?: string
  phoneNumber?: string
  jobDescription?: string
  hireDate?: string
  notes?: string
}

/**
 * 新しいユーザーを作成
 *
 * @param user - セッションユーザー情報
 * @param params - 作成するユーザー情報
 * @returns 作成されたユーザー情報
 * @throws AuthorizationError - 権限がない場合
 */
export async function createUser(user: SessionUser, params: CreateUserParams) {
  // 権限チェック: MANAGER以上のみ作成可能
  if (
    user.role !== UserRole.MANAGER &&
    user.role !== UserRole.AREA_MANAGER &&
    user.role !== UserRole.SYSTEM_ADMIN
  ) {
    throw new AuthorizationError("ユーザーを作成する権限がありません。")
  }

  // SYSTEM_ADMIN以外はSYSTEM_ADMINを作成できない
  if (params.role === UserRole.SYSTEM_ADMIN && user.role !== UserRole.SYSTEM_ADMIN) {
    throw new AuthorizationError("SYSTEM_ADMINユーザーを作成する権限がありません。")
  }

  // バリデーション
  const trimmedEmail = params.email.trim().toLowerCase()
  const trimmedName = params.name.trim()

  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    throw new Error("有効なメールアドレスを入力してください。")
  }

  if (!trimmedName || trimmedName.length === 0) {
    throw new Error("名前は必須です。")
  }

  if (trimmedName.length > 100) {
    throw new Error("名前は100文字以内で入力してください。")
  }

  if (!params.password || params.password.length < 8) {
    throw new Error("パスワードは8文字以上で入力してください。")
  }

  if (params.groupIds.length === 0) {
    throw new Error("少なくとも1つのグループを指定してください。")
  }

  // メールアドレスの重複チェック
  const existingUser = await prisma.user.findUnique({
    where: { email: trimmedEmail },
  })

  if (existingUser) {
    throw new Error("このメールアドレスは既に使用されています。")
  }

  // MANAGER以下は自分が所属するグループにのみユーザーを追加可能
  if (user.role !== UserRole.SYSTEM_ADMIN) {
    const userMemberships = await prisma.groupMembership.findMany({
      where: { userId: user.id },
      select: { groupId: true },
    })

    const allowedGroupIds = userMemberships.map((m) => m.groupId)
    const invalidGroupIds = params.groupIds.filter((gid) => !allowedGroupIds.includes(gid))

    if (invalidGroupIds.length > 0) {
      throw new AuthorizationError("指定されたグループにユーザーを追加する権限がありません。")
    }
  }

  // パスワードのハッシュ化
  const passwordHash = await bcrypt.hash(params.password, 10)

  // ユーザー作成とグループメンバーシップの作成をトランザクションで実行
  const newUser = await prisma.$transaction(async (tx) => {
    // マネージャー以上の場合は任意情報を無視、ワーカーの場合のみ保存
    const isWorker = params.role === UserRole.MEMBER
    const userData = {
      email: trimmedEmail,
      passwordHash,
      name: trimmedName,
      role: params.role,
      locale: params.locale || "ja",
      ...(isWorker && {
        countryOfOrigin: params.countryOfOrigin ? params.countryOfOrigin.trim() : undefined,
        dateOfBirth: params.dateOfBirth ? new Date(params.dateOfBirth) : undefined,
        gender: params.gender ? params.gender.trim() : undefined,
        address: params.address ? params.address.trim() : undefined,
        phoneNumber: params.phoneNumber ? params.phoneNumber.trim() : undefined,
        jobDescription: params.jobDescription ? params.jobDescription.trim() : undefined,
        hireDate: params.hireDate ? new Date(params.hireDate) : undefined,
        notes: params.notes ? params.notes.trim() : undefined,
      }),
    }

    const createdUser = await tx.user.create({
      data: userData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        locale: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    // グループメンバーシップの作成
    await tx.groupMembership.createMany({
      data: params.groupIds.map((groupId) => ({
        userId: createdUser.id,
        groupId,
        role: params.role === UserRole.MANAGER ? MembershipRole.MANAGER : MembershipRole.MEMBER,
      })),
    })

    return createdUser
  })

  console.log(`[user] User created: ${newUser.email} by ${user.id}`)

  return newUser
}

export interface UpdateUserGroupsParams {
  groupIds: string[]
}

/**
 * ユーザーのグループメンバーシップを更新
 *
 * @param user - セッションユーザー情報
 * @param targetUserId - 更新対象のユーザーID
 * @param params - 更新するグループID一覧
 * @returns 更新後のユーザー情報
 * @throws AuthorizationError - 権限がない場合
 */
export async function updateUserGroups(
  user: SessionUser,
  targetUserId: string,
  params: UpdateUserGroupsParams,
) {
  // 権限チェック: MANAGER以上のみ更新可能
  if (
    user.role !== UserRole.MANAGER &&
    user.role !== UserRole.AREA_MANAGER &&
    user.role !== UserRole.SYSTEM_ADMIN
  ) {
    throw new AuthorizationError("ユーザーのグループを変更する権限がありません。")
  }

  // 対象ユーザーの取得
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, email: true },
  })

  if (!targetUser) {
    throw new Error("ユーザーが見つかりません。")
  }

  // SYSTEM_ADMINのグループは変更できない
  if (targetUser.role === UserRole.SYSTEM_ADMIN && user.role !== UserRole.SYSTEM_ADMIN) {
    throw new AuthorizationError("SYSTEM_ADMINユーザーのグループは変更できません。")
  }

  // MANAGER以下は自分が所属するグループにのみユーザーを追加可能
  if (user.role !== UserRole.SYSTEM_ADMIN) {
    const userMemberships = await prisma.groupMembership.findMany({
      where: { userId: user.id },
      select: { groupId: true },
    })

    const allowedGroupIds = userMemberships.map((m) => m.groupId)
    const invalidGroupIds = params.groupIds.filter((gid) => !allowedGroupIds.includes(gid))

    if (invalidGroupIds.length > 0) {
      throw new AuthorizationError("指定されたグループにユーザーを追加する権限がありません。")
    }

    // 削除する既存のメンバーシップも権限チェック
    const currentMemberships = await prisma.groupMembership.findMany({
      where: { userId: targetUserId },
      select: { groupId: true },
    })

    const toRemoveGroupIds = currentMemberships
      .map((m) => m.groupId)
      .filter((gid) => !params.groupIds.includes(gid))

    const invalidRemoveGroupIds = toRemoveGroupIds.filter((gid) => !allowedGroupIds.includes(gid))

    if (invalidRemoveGroupIds.length > 0) {
      throw new AuthorizationError("指定されたグループからユーザーを削除する権限がありません。")
    }
  }

  // グループメンバーシップの更新をトランザクションで実行
  const updatedUser = await prisma.$transaction(async (tx) => {
    // 既存のメンバーシップを削除
    await tx.groupMembership.deleteMany({
      where: { userId: targetUserId },
    })

    // 新しいメンバーシップを作成
    if (params.groupIds.length > 0) {
      await tx.groupMembership.createMany({
        data: params.groupIds.map((groupId) => ({
          userId: targetUserId,
          groupId,
          role:
            targetUser.role === UserRole.MANAGER ? MembershipRole.MANAGER : MembershipRole.MEMBER,
        })),
      })
    }

    // 更新後のユーザー情報を取得
    return await tx.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        locale: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
        memberships: {
          include: {
            group: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    })
  })

  console.log(`[user] Groups updated for user ${targetUserId} by ${user.id}`)

  return updatedUser
}

/**
 * グループ一覧を取得
 *
 * @param user - セッションユーザー情報
 * @returns グループ一覧
 * @throws AuthorizationError - 権限がない場合
 */
export async function listGroups(user: SessionUser) {
  // 権限チェック: MANAGER以上のみ閲覧可能
  if (
    user.role !== UserRole.MANAGER &&
    user.role !== UserRole.AREA_MANAGER &&
    user.role !== UserRole.SYSTEM_ADMIN
  ) {
    throw new AuthorizationError("グループ一覧を閲覧する権限がありません。")
  }

  // SYSTEM_ADMINは全グループを閲覧可能
  if (user.role === UserRole.SYSTEM_ADMIN) {
    return await prisma.group.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        organizationId: true,
      },
      orderBy: { name: "asc" },
    })
  }

  // MANAGER以下は自分が所属するグループのみ閲覧可能
  const userMemberships = await prisma.groupMembership.findMany({
    where: { userId: user.id },
    select: {
      group: {
        select: {
          id: true,
          name: true,
          description: true,
          organizationId: true,
        },
      },
    },
  })

  return userMemberships.map((m) => m.group).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * ユーザーを無効化
 *
 * @param user - セッションユーザー情報
 * @param targetUserId - 無効化対象のユーザーID
 * @returns 更新後のユーザー情報
 * @throws AuthorizationError - 権限がない場合
 */
export async function deactivateUser(user: SessionUser, targetUserId: string) {
  // 権限チェック: MANAGER以上
  if (
    user.role !== UserRole.MANAGER &&
    user.role !== UserRole.AREA_MANAGER &&
    user.role !== UserRole.SYSTEM_ADMIN
  ) {
    throw new AuthorizationError("ユーザーを無効化する権限がありません。")
  }

  // 自分自身は無効化できない
  if (user.id === targetUserId) {
    throw new Error("自分自身を無効化することはできません。")
  }

  // 対象ユーザーの取得
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, email: true, isActive: true },
  })

  if (!targetUser) {
    throw new Error("ユーザーが見つかりません。")
  }

  // 既に無効化されている
  if (!targetUser.isActive) {
    throw new Error("このユーザーは既に無効化されています。")
  }

  // SYSTEM_ADMINは他のSYSTEM_ADMINしか無効化できない
  if (targetUser.role === UserRole.SYSTEM_ADMIN && user.role !== UserRole.SYSTEM_ADMIN) {
    throw new AuthorizationError("SYSTEM_ADMINユーザーを無効化する権限がありません。")
  }

  const updatedUser = await prisma.user.update({
    where: { id: targetUserId },
    data: { isActive: false },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      locale: true,
      isActive: true,
      updatedAt: true,
    },
  })

  console.log(`[user] User deactivated: ${targetUser.email} by ${user.id}`)

  return updatedUser
}

/**
 * ユーザーを有効化
 *
 * @param user - セッションユーザー情報
 * @param targetUserId - 有効化対象のユーザーID
 * @returns 更新後のユーザー情報
 * @throws AuthorizationError - 権限がない場合
 */
export async function activateUser(user: SessionUser, targetUserId: string) {
  // 権限チェック: MANAGER以上
  if (
    user.role !== UserRole.MANAGER &&
    user.role !== UserRole.AREA_MANAGER &&
    user.role !== UserRole.SYSTEM_ADMIN
  ) {
    throw new AuthorizationError("ユーザーを有効化する権限がありません。")
  }

  // 対象ユーザーの取得
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, email: true, isActive: true },
  })

  if (!targetUser) {
    throw new Error("ユーザーが見つかりません。")
  }

  // 既に有効化されている
  if (targetUser.isActive) {
    throw new Error("このユーザーは既に有効化されています。")
  }

  const updatedUser = await prisma.user.update({
    where: { id: targetUserId },
    data: { isActive: true },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      locale: true,
      isActive: true,
      updatedAt: true,
    },
  })

  console.log(`[user] User activated: ${targetUser.email} by ${user.id}`)

  return updatedUser
}
