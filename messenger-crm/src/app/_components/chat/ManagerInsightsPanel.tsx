/**
 * マネージャー用インサイトパネルコンポーネント
 */

import { Bot, X } from "lucide-react"
import type { CaseStatus } from "@prisma/client"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

import type { ManagerInsightsPanelProps } from "./types"
import { getInitials, getLocaleLabel, splitSuggestionContent } from "./utils"

const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  IN_PROGRESS: "対応中",
  RESOLVED: "解決済み",
  ESCALATED: "エスカレーション",
  ON_HOLD: "保留",
}

export function ManagerInsightsPanel({
  conversation,
  consultation,
  suggestions,
  onSelectSuggestion,
  onFocusComposer,
  onRegenerateSuggestions,
  regeneratingSuggestions,
  regenerateError,
  tags,
  onRemoveTag,
  onAddTag,
  newTag,
  onNewTagChange,
  contact,
  segments,
  preferredLanguage: _preferredLanguage,
  workerNotes,
  onNotesChange,
  onSaveNotes,
  savingNotes,
}: ManagerInsightsPanelProps) {
  const toneLabelMap: Record<string, string> = {
    question: "質問",
    empathy: "共感",
    solution: "解決策",
    summary: "要約",
    "check-in": "チェックイン",
    "gentle-follow-up": "フォローアップ",
    continuation: "継続",
    encouragement: "励まし",
  }

  const statusLabel = conversation
    ? CASE_STATUS_LABEL[conversation.status as CaseStatus] ?? conversation.status
    : null
  const isOnline = conversation ? conversation.status === "IN_PROGRESS" : false
  const contactEmail = contact?.email ?? "未登録"
  const contactPhone = "未登録"
  const contactAddress = conversation ? conversation.group.name : "未登録"
  const artifact = consultation?.llmArtifact

  return (
    <aside className="hidden h-full min-h-0 w-full overflow-hidden border-l bg-[#f5f7ff] px-5 py-6 md:flex md:resize-x" style={{ minWidth: '320px', maxWidth: '80vw' }}>
      <div className="flex h-full w-full flex-col gap-6 xl:flex-row">
        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-800">AI返信</h2>
            {conversation && !(artifact?.extra && typeof artifact.extra === 'object' && 'healthConsultationInProgress' in artifact.extra && artifact.extra.healthConsultationInProgress) ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                type="button"
                onClick={onRegenerateSuggestions}
                disabled={regeneratingSuggestions}
                aria-busy={regeneratingSuggestions}
              >
                <Bot className="h-4 w-4" />
                {regeneratingSuggestions ? "生成中..." : suggestions.length === 0 ? "生成" : "再生成"}
              </Button>
            ) : null}
          </div>
          <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
            {suggestions.length === 0 ? (
              <div className="text-center py-8">
                {artifact?.extra && typeof artifact.extra === 'object' && 'healthConsultationInProgress' in artifact.extra && artifact.extra.healthConsultationInProgress ? (
                  <>
                    <p className="text-xs text-muted-foreground mb-2">
                      🏥 健康相談対応中
                    </p>
                    <p className="text-xs text-muted-foreground">
                      システムが自動で対応しています。
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      必要に応じてマネージャーからもメッセージを送信できます。
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground mb-4">
                    {conversation ? "「生成」ボタンをクリックして初回メッセージを生成できます。" : "会話を選択してください。"}
                  </p>
                )}
              </div>
            ) : (
              suggestions.map((suggestion, index) => {
                const toneKey = suggestion.tone ? suggestion.tone.toLowerCase() : ""
                const toneLabel = toneLabelMap[toneKey] ?? suggestion.tone ?? "提案"
                const { primary, secondary } = splitSuggestionContent(suggestion.content)
                return (
                  <button
                    key={`${suggestion.content}-${index}`}
                    type="button"
                    onClick={() => onSelectSuggestion(suggestion.content, index)}
                    className="w-full text-left"
                  >
                    <Card className="border border-slate-200 shadow-sm transition hover:border-[#0F2C82]/40 hover:shadow-md">
                      <CardContent className="space-y-2.5 px-4 py-3">
                        <div className="flex items-center text-xs text-muted-foreground">
                          <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[11px] font-medium">
                            {toneLabel}
                          </Badge>
                        </div>
                        <div className="space-y-2.5 text-sm leading-relaxed text-slate-700">
                          <p className="whitespace-pre-wrap">{primary}</p>
                          {secondary ? (
                            <div className="border-t border-slate-200 pt-2.5 text-slate-600">
                              <p className="whitespace-pre-wrap text-xs sm:text-sm">{secondary}</p>
                            </div>
                          ) : null}
                          {suggestion.translation ? (
                            <div className="border-t border-slate-200 pt-2.5 text-slate-600">
                              <p className="whitespace-pre-wrap text-xs leading-relaxed">{suggestion.translation}</p>
                            </div>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  </button>
                )
              })
            )}
          </div>
          {regenerateError ? <p className="mt-3 text-xs text-destructive">{regenerateError}</p> : null}
          <div className="mt-4 space-y-3">
            <Button type="button" variant="secondary" className="w-full" onClick={onFocusComposer}>
              自分で入力する
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              AI返信を選択するか、自分で入力して返信を作成してください。
            </p>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">ユーザー情報</h2>
        {conversation ? (
          <div className="mt-4 space-y-5 overflow-y-auto text-sm text-slate-700">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12">
                <AvatarFallback>{getInitials(conversation.worker.name)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold">{conversation.worker.name ?? "相談者"}</p>
                <p className="text-xs text-muted-foreground">
                  {[conversation.worker.locale ? getLocaleLabel(conversation.worker.locale) : null, conversation.group.name]
                    .filter(Boolean)
                    .join(" ・ ")}
                </p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="font-semibold text-slate-700">ステータス</p>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                <span
                  className={`inline-flex h-2 w-2 rounded-full ${isOnline ? "bg-emerald-500" : "bg-slate-300"}`}
                  aria-hidden
                />
                <span>{isOnline ? "オンライン" : "オフライン"}</span>
                {statusLabel ? <Badge variant="outline">{statusLabel}</Badge> : null}
                {consultation ? <Badge variant="secondary">{consultation.category}</Badge> : null}
                {consultation?.priority === "HIGH" ? (
                  <Badge className="bg-[#FF4D4F] text-white">緊急</Badge>
                ) : null}
              </div>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="font-semibold text-slate-700">相談タグ</p>
              {tags.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  {tags.map((tag) => (
                    <span key={`detail-${tag.id}`} className="inline-flex items-center">
                      <Badge
                        variant={tag.tone === "urgent" ? "destructive" : "secondary"}
                        className={
                          tag.tone === "urgent"
                            ? "bg-[#FF4D4F] text-white"
                            : "bg-slate-100 text-slate-700"
                        }
                      >
                        {tag.label}
                        <button
                          type="button"
                          onClick={() => onRemoveTag(tag)}
                          className={`ml-1 inline-flex items-center justify-center rounded-full p-0.5 ${
                            tag.tone === "urgent" ? "hover:bg-white/20" : "hover:bg-slate-200"
                          }`}
                          aria-label={`${tag.label} を削除`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">タグは現在ありません。</p>
              )}
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  onAddTag()
                }}
              >
                <Input
                  value={newTag}
                  onChange={(event) => onNewTagChange(event.target.value)}
                  placeholder="タグを追加"
                  className="h-9 flex-1 min-w-[140px]"
                />
                <Button type="submit" variant="outline" disabled={!newTag.trim()}>
                  追加
                </Button>
              </form>
            </div>

            {consultation?.summary ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-semibold text-slate-700">AI分析サマリー</p>
                <p className="rounded-xl bg-slate-50 p-3 text-[12px] text-slate-600">{consultation.summary}</p>
              </div>
            ) : null}

            {consultation?.description ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-semibold text-slate-700">相談内容メモ</p>
                <p className="rounded-xl border border-dashed border-slate-200 p-3 text-[12px] text-slate-600">
                  {consultation.description}
                </p>
              </div>
            ) : null}

            {segments.length > 0 ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-semibold text-slate-700">過去の話題リスト</p>
                <div className="space-y-2">
                  {segments.map((segment, index) => (
                    <div
                      key={segment.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-3 transition hover:bg-slate-100"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-800">
                          {index + 1}. {segment.title}
                        </p>
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {segment.messageIds.length}件
                        </Badge>
                      </div>
                      {segment.summary ? (
                        <p className="mt-1 text-[11px] text-slate-600">{segment.summary}</p>
                      ) : null}
                      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block h-1 w-1 rounded-full bg-slate-400" />
                          {new Date(segment.startedAt).toLocaleString("ja-JP", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span>〜</span>
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block h-1 w-1 rounded-full bg-slate-400" />
                          {new Date(segment.endedAt).toLocaleString("ja-JP", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="font-semibold text-slate-700">連絡先情報</p>
              <div className="rounded-xl bg-slate-50 p-3 text-[12px] text-slate-600">
                <p>電話: {contactPhone}</p>
                <p>メール: {contactEmail}</p>
                <p>住所: {contactAddress}</p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="font-semibold text-slate-700">備考</p>
              <Textarea
                placeholder="個別面談の内容などを入力..."
                className="min-h-[100px] text-sm"
                value={workerNotes}
                onChange={(e) => onNotesChange(e.target.value)}
                onBlur={() => onSaveNotes(workerNotes)}
                disabled={savingNotes}
              />
              <p className="text-[10px] text-muted-foreground">
                {savingNotes ? "保存中..." : "備考はAI返信のコンテキストとして使用されます。"}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-muted-foreground">
            相談者を選択すると、AI返信と相談者情報がここに表示されます。
          </div>
        )}
        </section>
      </div>
    </aside>
  )
}
