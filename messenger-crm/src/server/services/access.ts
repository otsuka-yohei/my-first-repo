import { UserRole } from "@prisma/client"

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
  if (user.role === UserRole.WORKER) {
    const [record, memberships] = await Promise.all([
      prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, name: true, email: true },
      }),
      prisma.groupMembership.findMany({
        where: { userId: user.id },
        select: { groupId: true },
      }),
    ])

    if (!record) {
      return []
    }

    return [
      {
        id: record.id,
        name: record.name,
        email: record.email,
        groupIds: memberships.map((membership) => membership.groupId),
      },
    ]
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
      user: { role: UserRole.WORKER },
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
