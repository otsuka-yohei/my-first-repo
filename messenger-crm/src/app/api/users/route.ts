import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { UserRole } from "@prisma/client"

import { auth } from "@/auth"
import { AuthorizationError } from "@/server/auth/permissions"
import { createUser, listUsers } from "@/server/services/user"

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
  role: z.nativeEnum(UserRole),
  groupIds: z.array(z.string()).min(1),
  locale: z.enum(["ja", "vi", "en"]).optional(),
  countryOfOrigin: z.string().max(100).optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  phoneNumber: z.string().max(50).optional(),
  jobDescription: z.string().max(500).optional(),
  hireDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
})

/**
 * ユーザー一覧取得
 */
export async function GET() {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const users = await listUsers({ id: session.user.id, role: session.user.role })

    return NextResponse.json({ users })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Failed to list users", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list users" },
      { status: 500 },
    )
  }
}

/**
 * ユーザー作成
 */
export async function POST(req: NextRequest) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const json = await req.json()
  const parsed = createUserSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.errors },
      { status: 400 },
    )
  }

  try {
    const user = await createUser({ id: session.user.id, role: session.user.role }, parsed.data)

    return NextResponse.json({ user }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Failed to create user", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create user" },
      { status: 500 },
    )
  }
}
