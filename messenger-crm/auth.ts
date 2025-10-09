import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { compare } from "bcryptjs"
import { type UserRole } from "@prisma/client"

import { prisma } from "@/server/db"
import { env } from "@/server/env"
import { z } from "zod"

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma) as any,
  secret: env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  trustHost: true,
  providers: [
    Credentials({
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials)
        if (!parsed.success) {
          return null
        }

        const { email, password } = parsed.data
        const user = await prisma.user.findUnique({
          where: { email },
        })

        if (!user) {
          return null
        }

        const passwordValid = await compare(password, user.passwordHash)
        if (!passwordValid) {
          return null
        }

        const { passwordHash, ...sanitizedUser } = user
        return sanitizedUser
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id
        token.role = (user.role ?? "WORKER") as UserRole
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string
        session.user.role = token.role as UserRole
      }
      return session
    },
  },
})
