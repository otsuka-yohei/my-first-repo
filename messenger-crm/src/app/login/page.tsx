import { redirect } from "next/navigation"

import { auth } from "@/auth"

import { LoginForm } from "./login-form"

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth()
  const params = await searchParams
  const callbackParam = params?.callbackUrl
  const callbackUrl = Array.isArray(callbackParam) ? callbackParam[0] : callbackParam

  if (session?.user) {
    redirect(callbackUrl || "/")
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <LoginForm callbackUrl={callbackUrl} />
    </div>
  )
}
