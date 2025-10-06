import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "個人設定",
}

export default function SettingsPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 p-10">
      <div className="w-full max-w-xl space-y-6 rounded-2xl border bg-white p-10 shadow">
        <h1 className="text-xl font-semibold">個人設定</h1>
        <p className="text-sm text-muted-foreground">この画面は準備中です。表示名やアイコン、表示言語の変更機能をここに追加予定です。</p>
      </div>
    </main>
  )
}
