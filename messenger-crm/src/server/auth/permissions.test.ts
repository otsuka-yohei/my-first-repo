import { describe, expect, it } from "vitest"

import { MembershipRole, UserRole } from "@prisma/client"

import { AuthorizationError, canAccessGroup, ensureRole, roleAtLeast } from "./permissions"

describe("ensureRole", () => {
  it("allows when role is in the allowed list", () => {
    expect(() => ensureRole(UserRole.MANAGER, [UserRole.MANAGER, UserRole.SYSTEM_ADMIN])).not.toThrow()
  })

  it("throws when role is not allowed", () => {
    expect(() => ensureRole(UserRole.MEMBER, [UserRole.MANAGER])).toThrow(AuthorizationError)
  })
})

describe("roleAtLeast", () => {
  it("allows when role meets tier", () => {
    expect(() => roleAtLeast(UserRole.SYSTEM_ADMIN, UserRole.MANAGER)).not.toThrow()
  })

  it("throws when role is below tier", () => {
    expect(() => roleAtLeast(UserRole.MEMBER, UserRole.MANAGER)).toThrow(AuthorizationError)
  })
})

describe("canAccessGroup", () => {
  const memberships = [
    { groupId: "group-1", role: MembershipRole.MEMBER },
    { groupId: "group-2", role: MembershipRole.MANAGER },
  ]

  it("allows system admin regardless of membership", () => {
    expect(canAccessGroup(UserRole.SYSTEM_ADMIN, [], "group-x")).toBe(true)
  })

  it("allows manager with membership", () => {
    expect(canAccessGroup(UserRole.MANAGER, memberships, "group-2")).toBe(true)
  })

  it("denies manager without membership", () => {
    expect(canAccessGroup(UserRole.MANAGER, memberships, "group-3")).toBe(false)
  })

  it("allows worker only when member", () => {
    expect(canAccessGroup(UserRole.MEMBER, memberships, "group-1")).toBe(true)
    expect(canAccessGroup(UserRole.MEMBER, memberships, "group-3")).toBe(false)
  })
})
