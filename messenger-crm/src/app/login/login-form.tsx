"use client"

import { useFormState, useFormStatus } from "react-dom"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { loginAction, type LoginFormState } from "./actions"

interface LoginFormProps {
  callbackUrl?: string
}

const initialState: LoginFormState = {}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "サインイン中..." : "サインイン"}
    </Button>
  )
}

export function LoginForm({ callbackUrl }: LoginFormProps) {
  const [state, formAction] = useFormState(loginAction, initialState)

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Messenger CRM</CardTitle>
        <p className="text-sm text-muted-foreground">アカウントにサインインしてください。</p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <div className="space-y-2">
            <Label htmlFor="email">メールアドレス</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">パスワード</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </div>
          {state?.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}
          <SubmitButton />
        </form>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          パスワードを忘れた場合は管理者にご連絡ください。
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          テスト用アカウント: <code>admin@example.com / ChangeMe123!</code>
        </p>
        <p className="mt-4 text-center text-xs">
          <Link href="https://next-auth.js.org/" target="_blank" className="underline">
            セキュリティとログインに関する詳細
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
