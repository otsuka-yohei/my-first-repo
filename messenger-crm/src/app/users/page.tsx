import type { Metadata } from "next"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "顧客管理",
  description: "ユーザー情報の登録・更新・削除を行います",
}

const SAMPLE_USERS = [
  {
    id: "user-1",
    name: "Nguyễn Văn An",
    email: "an@example.com",
    role: "WORKER",
    groups: ["Default Store"],
  },
  {
    id: "user-2",
    name: "Default Manager",
    email: "manager@example.com",
    role: "MANAGER",
    groups: ["Default Store"],
  },
]

export default function UsersPage() {
  return (
    <main className="flex min-h-screen flex-col gap-8 bg-muted/20 p-10">
      <section className="rounded-2xl border bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">ユーザー一覧</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          マネージャー以上のロールでは、所属グループのユーザー情報を更新できます。
        </p>
        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-3">名前</th>
                <th className="py-3">メール</th>
                <th className="py-3">ロール</th>
                <th className="py-3">所属グループ</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_USERS.map((user) => (
                <tr key={user.id} className="border-b">
                  <td className="py-3 font-medium">{user.name}</td>
                  <td className="py-3">{user.email}</td>
                  <td className="py-3">{user.role}</td>
                  <td className="py-3">{user.groups.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">ユーザーを登録</h2>
          <form className="mt-4 space-y-3">
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="create-name">
                名前
              </label>
              <Input id="create-name" placeholder="山田 太郎" className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="create-email">
                メールアドレス
              </label>
              <Input id="create-email" placeholder="user@example.com" className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="create-role">
                ロール
              </label>
              <select id="create-role" className="mt-1 w-full rounded-md border bg-white p-2 text-sm">
                <option value="WORKER">WORKER</option>
                <option value="MANAGER">MANAGER</option>
                <option value="AREA_MANAGER">AREA_MANAGER</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="create-groups">
                所属グループ
              </label>
              <Input id="create-groups" placeholder="Default Store" className="mt-1" />
            </div>
            <Button type="button" className="w-full">
              登録 (準備中)
            </Button>
          </form>
        </div>

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">所属グループを変更</h2>
          <form className="mt-4 space-y-3">
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="update-user">
                対象ユーザー
              </label>
              <select id="update-user" className="mt-1 w-full rounded-md border bg-white p-2 text-sm">
                {SAMPLE_USERS.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="update-group">
                新しいグループ
              </label>
              <Input id="update-group" placeholder="Default Store" className="mt-1" />
            </div>
            <Button type="button" className="w-full">
              グループを変更 (準備中)
            </Button>
          </form>
        </div>
      </section>
    </main>
  )
}
