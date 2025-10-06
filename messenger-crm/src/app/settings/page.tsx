import type { Metadata } from "next"

import SettingsClient from "./settings-client"

export const metadata: Metadata = {
  title: "個人設定",
  description: "表示名や表示言語、プロフィール画像を調整します",
}

export default function SettingsPage() {
  return <SettingsClient />
}
