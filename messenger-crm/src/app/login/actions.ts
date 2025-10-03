"use server"

import { AuthError } from "next-auth"
import { z } from "zod"

import { signIn } from "@/auth"

export interface LoginFormState {
  error?: string
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  callbackUrl: z.string().optional(),
})

export async function loginAction(_: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const raw = Object.fromEntries(formData.entries())
  const parsed = loginSchema.safeParse(raw)

  if (!parsed.success) {
    return { error: "メールアドレスまたはパスワードをご確認ください。" }
  }

  const { email, password, callbackUrl } = parsed.data

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: callbackUrl || "/",
    })
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        return { error: "メールアドレスまたはパスワードが正しくありません。" }
      }
      return { error: "ログインに失敗しました。時間をおいて再度お試しください。" }
    }
    throw error
  }

  return {}
}
