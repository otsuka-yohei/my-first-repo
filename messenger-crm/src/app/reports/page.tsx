import type { Metadata } from "next"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = {
  title: "分析レポート",
  description: "相談履歴やAI分析のハイライトを確認できます",
}

const CASE_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  RESOLVED: "secondary",
  IN_PROGRESS: "default",
  ESCALATED: "destructive",
  ON_HOLD: "default",
}

const CASE_STATUS_LABEL: Record<string, string> = {
  RESOLVED: "解決済み",
  IN_PROGRESS: "対応中",
  ESCALATED: "エスカレーション",
  ON_HOLD: "保留",
}

const SAMPLE_CASES = [
  {
    id: "case-1",
    subject: "住居契約の更新",
    user: "Nguyễn Văn An",
    language: "ベトナム語",
    status: "IN_PROGRESS",
    updatedAt: "2時間前",
    aiSummary: "追加料金の根拠を確認し、契約書の写しを依頼",
  },
  {
    id: "case-2",
    subject: "給与の未払い",
    user: "Sari Dewi",
    language: "インドネシア語",
    status: "RESOLVED",
    updatedAt: "昨日",
    aiSummary: "勤務時間の記録を整理し、改善計画を提示",
  },
  {
    id: "case-3",
    subject: "休暇申請の拒否",
    user: "Budi Santoso",
    language: "インドネシア語",
    status: "ESCALATED",
    updatedAt: "3日前",
    aiSummary: "法的背景の確認が必要との判断で管理部門へ連携",
  },
]

const LANG_ANALYTICS = [
  { language: "ベトナム語", ratio: "42%", trend: "先月比 +5%" },
  { language: "インドネシア語", ratio: "31%", trend: "先月比 -2%" },
  { language: "タガログ語", ratio: "17%", trend: "先月比 +1%" },
]

const KPI_LIST = [
  { label: "今月の新規相談", value: "24件" },
  { label: "平均初回返信時間", value: "18分" },
  { label: "AI提案活用率", value: "63%" },
]

export default function ReportsPage() {
  return (
    <main className="flex min-h-screen flex-col gap-8 bg-muted/20 p-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">分析レポート</h1>
        <p className="text-sm text-muted-foreground">
          相談履歴の推移やAI分析の要点を確認し、チームの対応状況を把握できます。
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-3">
        {KPI_LIST.map((item) => (
          <Card key={item.label} className="border-none bg-white shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <Card className="border-none bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">相談履歴</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {SAMPLE_CASES.map((item) => (
              <article key={item.id} className="rounded-2xl border border-slate-100 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold">{item.subject}</h3>
                  <Badge variant={CASE_STATUS_VARIANT[item.status] ?? "default"}>
                    {CASE_STATUS_LABEL[item.status] ?? item.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{item.updatedAt}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{item.user} ・ {item.language}</p>
                <p className="mt-3 text-sm">
                  {item.aiSummary}
                </p>
              </article>
            ))}
          </CardContent>
        </Card>

        <Card className="border-none bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">AI分析ハイライト</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {LANG_ANALYTICS.map((item) => (
              <div key={item.language} className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm font-semibold">{item.language}</p>
                <p className="mt-1 text-2xl font-semibold text-[#0F2C82]">{item.ratio}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.trend}</p>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              LLMが抽出したリスク要因やフォローアップ候補は、個別の相談詳細画面から確認できます。
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
