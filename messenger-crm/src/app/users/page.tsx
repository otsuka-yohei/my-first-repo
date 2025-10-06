import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "顧客管理",
}

export default function UsersPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 p-10">
      <div className="rounded-2xl border bg-white p-10 shadow">
        <h1 className="text-xl font-semibold">顧客管理</h1>
        <p className="mt-4 text-sm text-muted-foreground">この画面は準備中です。</p>
      </div>
    </main>
  )
}
