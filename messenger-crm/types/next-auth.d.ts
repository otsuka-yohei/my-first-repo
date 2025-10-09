import { type DefaultSession } from "next-auth"
import { type JWT } from "next-auth/jwt"
import { type UserRole } from "@prisma/client"

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: DefaultSession["user"] & {
      id: string
      role: UserRole
      locale: string
    }
  }

  interface User {
    role: UserRole
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string
    role?: UserRole
    locale?: string
  }
}
