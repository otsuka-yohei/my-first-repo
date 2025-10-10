import { MembershipRole, UserRole } from "@prisma/client"

import { prisma } from "@/server/db"

interface SessionUser {
  id: string
  role: UserRole
}

export async function listGroupsForUser(user: SessionUser) {
  if (user.role === UserRole.SYSTEM_ADMIN || user.role === UserRole.AREA_MANAGER) {
    const groups = await prisma.group.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
    return groups
  }

  const memberships = await prisma.groupMembership.findMany({
    where: { userId: user.id },
    include: {
      group: { select: { id: true, name: true } },
    },
  })

  const unique = new Map<string, { id: string; name: string }>()
  memberships.forEach((membership) => {
    unique.set(membership.group.id, membership.group)
  })

  return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name))
}

export async function listWorkersForConversationCreation(user: SessionUser) {
  if (user.role === UserRole.MEMBER) {
    const memberships = await prisma.groupMembership.findMany({
      where: { userId: user.id },
      select: { groupId: true },
    })

    const groupIds = memberships.map((membership) => membership.groupId)
    if (!groupIds.length) {
      return []
    }

    const managerMemberships = await prisma.groupMembership.findMany({
      where: {
        groupId: { in: groupIds },
        role: MembershipRole.MANAGER,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    })

    const aggregate = new Map<
      string,
      { id: string; name: string | null; email: string | null; groupIds: Set<string> }
    >()

    for (const membership of managerMemberships) {
      const existing = aggregate.get(membership.userId)
      if (existing) {
        existing.groupIds.add(membership.groupId)
      } else {
        aggregate.set(membership.userId, {
          id: membership.user.id,
          name: membership.user.name,
          email: membership.user.email,
          groupIds: new Set([membership.groupId]),
        })
      }
    }

    return Array.from(aggregate.values())
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        email: entry.email,
        groupIds: Array.from(entry.groupIds),
      }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
  }

  let groupIds: string[] | undefined

  if (user.role === UserRole.SYSTEM_ADMIN || user.role === UserRole.AREA_MANAGER) {
    groupIds = undefined
  } else {
    const memberships = await prisma.groupMembership.findMany({
      where: { userId: user.id },
      select: { groupId: true },
    })
    groupIds = memberships.map((membership) => membership.groupId)
    if (!groupIds.length) {
      return []
    }
  }

  const workerMemberships = await prisma.groupMembership.findMany({
    where: {
      ...(groupIds ? { groupId: { in: groupIds } } : {}),
      user: { role: UserRole.MEMBER },
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  })

  const aggregate = new Map<
    string,
    { id: string; name: string | null; email: string | null; groupIds: Set<string> }
  >()

  for (const membership of workerMemberships) {
    const existing = aggregate.get(membership.userId)
    if (existing) {
      existing.groupIds.add(membership.groupId)
    } else {
      aggregate.set(membership.userId, {
        id: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        groupIds: new Set([membership.groupId]),
      })
    }
  }

  return Array.from(aggregate.values())
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      email: entry.email,
      groupIds: Array.from(entry.groupIds),
    }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
}
