import { MembershipRole, UserRole } from "@prisma/client"

type RoleRank = Record<UserRole, number>

const ROLE_RANK: RoleRank = {
  [UserRole.WORKER]: 0,
  [UserRole.MANAGER]: 1,
  [UserRole.AREA_MANAGER]: 2,
  [UserRole.SYSTEM_ADMIN]: 3,
}

export class AuthorizationError extends Error {
  constructor(message = "Unauthorized") {
    super(message)
    this.name = "AuthorizationError"
  }
}

export function ensureRole(userRole: UserRole, allowedRoles: UserRole[]) {
  if (!allowedRoles.includes(userRole)) {
    throw new AuthorizationError("Insufficient role")
  }
}

export function roleAtLeast(userRole: UserRole, minimumRole: UserRole) {
  if (ROLE_RANK[userRole] < ROLE_RANK[minimumRole]) {
    throw new AuthorizationError("Insufficient role tier")
  }
}

export function canAccessGroup(
  userRole: UserRole,
  memberships: Array<{ groupId: string; role: MembershipRole }>,
  targetGroupId: string,
) {
  if (userRole === UserRole.SYSTEM_ADMIN || userRole === UserRole.AREA_MANAGER) {
    return true
  }

  if (userRole === UserRole.MANAGER) {
    return memberships.some((membership) => membership.groupId === targetGroupId)
  }

  return memberships.some((membership) =>
    membership.groupId === targetGroupId && membership.role === MembershipRole.MEMBER,
  )
}
