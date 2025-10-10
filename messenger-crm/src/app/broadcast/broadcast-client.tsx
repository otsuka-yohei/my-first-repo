"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"

interface Group {
  id: string
  name: string
  description?: string | null
}

interface Worker {
  id: string
  name: string
  email: string
  locale?: string | null
  countryOfOrigin?: string | null
  dateOfBirth?: string | null
  gender?: string | null
  address?: string | null
  phoneNumber?: string | null
  jobDescription?: string | null
  hireDate?: string | null
  createdAt?: string
}

interface BroadcastClientProps {
  groups: Group[]
  currentUserId: string
}

export default function BroadcastClient({
  groups,
  currentUserId,
}: BroadcastClientProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string>("")
  const [workers, setWorkers] = useState<Worker[]>([])
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<Set<string>>(
    new Set()
  )
  const [message, setMessage] = useState("")
  const [isLoadingWorkers, setIsLoadingWorkers] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)

  // フィルター
  const [filterCountry, setFilterCountry] = useState("")
  const [filterGender, setFilterGender] = useState("")
  const [filterJob, setFilterJob] = useState("")
  const [filterName, setFilterName] = useState("")

  // フィルター適用後のワーカー
  const filteredWorkers = useMemo(() => {
    return workers.filter((worker) => {
      if (filterName && !worker.name.toLowerCase().includes(filterName.toLowerCase())) {
        return false
      }
      if (filterCountry && worker.countryOfOrigin !== filterCountry) {
        return false
      }
      if (filterGender && worker.gender !== filterGender) {
        return false
      }
      if (
        filterJob &&
        !worker.jobDescription?.toLowerCase().includes(filterJob.toLowerCase())
      ) {
        return false
      }
      return true
    })
  }, [workers, filterName, filterCountry, filterGender, filterJob])

  // ユニークな出身国リスト
  const countries = useMemo(() => {
    const set = new Set(
      workers.map((w) => w.countryOfOrigin).filter(Boolean) as string[]
    )
    return Array.from(set).sort()
  }, [workers])

  // ユニークな性別リスト
  const genders = useMemo(() => {
    const set = new Set(workers.map((w) => w.gender).filter(Boolean) as string[])
    return Array.from(set).sort()
  }, [workers])

  async function handleGroupChange(groupId: string) {
    setSelectedGroupId(groupId)
    setWorkers([])
    setSelectedWorkerIds(new Set())
    setFilterCountry("")
    setFilterGender("")
    setFilterJob("")
    setFilterName("")

    if (!groupId) return

    setIsLoadingWorkers(true)
    try {
      const response = await fetch(`/api/groups/${groupId}/workers`)
      if (!response.ok) {
        throw new Error("メンバー一覧の取得に失敗しました")
      }
      const data = await response.json()
      setWorkers(data.workers)
      // デフォルトで全員選択
      setSelectedWorkerIds(new Set(data.workers.map((w: Worker) => w.id)))
    } catch (error) {
      console.error("Failed to load workers:", error)
      setStatusMessage(
        error instanceof Error ? error.message : "メンバーの取得に失敗しました"
      )
      setIsSuccess(false)
    } finally {
      setIsLoadingWorkers(false)
    }
  }

  function handleToggleWorker(workerId: string) {
    setSelectedWorkerIds((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(workerId)) {
        newSet.delete(workerId)
      } else {
        newSet.add(workerId)
      }
      return newSet
    })
  }

  function handleSelectAll() {
    setSelectedWorkerIds(new Set(filteredWorkers.map((w) => w.id)))
  }

  function handleDeselectAll() {
    setSelectedWorkerIds(new Set())
  }

  async function handleSend() {
    if (!selectedGroupId || !message.trim() || selectedWorkerIds.size === 0) {
      setStatusMessage("グループ、メッセージ、送信先を選択してください")
      setIsSuccess(false)
      return
    }

    setIsSending(true)
    setStatusMessage(null)

    try {
      const response = await fetch("/api/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: selectedGroupId,
          message: message.trim(),
          recipientIds: Array.from(selectedWorkerIds),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "一斉送信に失敗しました")
      }

      const data = await response.json()
      setStatusMessage(
        `一斉送信が完了しました: ${data.sent}/${data.total}名に送信しました`
      )
      setIsSuccess(true)

      // 成功したらリセット
      setMessage("")
      setSelectedWorkerIds(new Set())
    } catch (error) {
      console.error("Failed to send broadcast:", error)
      setStatusMessage(
        error instanceof Error ? error.message : "一斉送信に失敗しました"
      )
      setIsSuccess(false)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col gap-8 bg-muted/20 p-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">一斉送信</h1>
        <p className="text-sm text-muted-foreground">
          グループに所属するメンバーに対して、メッセージを一斉送信します
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr,400px]">
        {/* メイン: メッセージ作成エリア */}
        <div className="space-y-6">
          <Card className="border-none bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">
                1. グループを選択
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="group-select">送信先グループ</Label>
                <select
                  id="group-select"
                  value={selectedGroupId}
                  onChange={(e) => handleGroupChange(e.target.value)}
                  className="w-full rounded-md border bg-white p-2 text-sm"
                  disabled={isLoadingWorkers || isSending}
                >
                  <option value="">-- グループを選択 --</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedGroupId && (
                <div className="rounded-md bg-slate-50 p-3 text-sm text-muted-foreground">
                  選択中:{" "}
                  {groups.find((g) => g.id === selectedGroupId)?.name}
                </div>
              )}
            </CardContent>
          </Card>

          {selectedGroupId && workers.length > 0 && (
            <>
              <Card className="border-none bg-white shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">
                    2. 送信先を絞り込み
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="filter-name">名前</Label>
                      <Input
                        id="filter-name"
                        value={filterName}
                        onChange={(e) => setFilterName(e.target.value)}
                        placeholder="名前で検索"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="filter-country">出身国</Label>
                      <select
                        id="filter-country"
                        value={filterCountry}
                        onChange={(e) => setFilterCountry(e.target.value)}
                        className="w-full rounded-md border bg-white p-2 text-sm"
                      >
                        <option value="">すべて</option>
                        {countries.map((country) => (
                          <option key={country} value={country}>
                            {country}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="filter-gender">性別</Label>
                      <select
                        id="filter-gender"
                        value={filterGender}
                        onChange={(e) => setFilterGender(e.target.value)}
                        className="w-full rounded-md border bg-white p-2 text-sm"
                      >
                        <option value="">すべて</option>
                        {genders.map((gender) => (
                          <option key={gender} value={gender}>
                            {gender}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="filter-job">業務内容</Label>
                      <Input
                        id="filter-job"
                        value={filterJob}
                        onChange={(e) => setFilterJob(e.target.value)}
                        placeholder="業務内容で検索"
                      />
                    </div>
                  </div>

                  <div className="rounded-md bg-slate-50 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        絞り込み結果: {filteredWorkers.length}名 /{" "}
                        {workers.length}名
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleSelectAll}
                        >
                          全て選択
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDeselectAll}
                        >
                          全て解除
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-none bg-white shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">
                    3. メッセージを作成
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="message">メッセージ本文</Label>
                    <Textarea
                      id="message"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="送信するメッセージを入力してください..."
                      rows={8}
                      disabled={isSending}
                    />
                    <p className="text-xs text-muted-foreground">
                      {message.length} 文字
                    </p>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      onClick={handleSend}
                      disabled={
                        isSending ||
                        !message.trim() ||
                        selectedWorkerIds.size === 0
                      }
                      size="lg"
                    >
                      {isSending
                        ? "送信中..."
                        : `${selectedWorkerIds.size}名に一斉送信`}
                    </Button>
                  </div>

                  {statusMessage && (
                    <div
                      className={`rounded-md p-3 text-sm ${
                        isSuccess
                          ? "bg-green-50 text-green-800"
                          : "bg-red-50 text-red-800"
                      }`}
                    >
                      {statusMessage}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {selectedGroupId && isLoadingWorkers && (
            <Card className="border-none bg-white shadow-sm">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                メンバー情報を読み込み中...
              </CardContent>
            </Card>
          )}
        </div>

        {/* サイドバー: 送信先リスト */}
        {selectedGroupId && workers.length > 0 && (
          <Card className="border-none bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">
                送信先リスト ({selectedWorkerIds.size}名選択中)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {filteredWorkers.map((worker) => {
                  const isSelected = selectedWorkerIds.has(worker.id)
                  return (
                    <div
                      key={worker.id}
                      className={`flex items-start gap-3 rounded-md border p-3 transition ${
                        isSelected
                          ? "border-blue-300 bg-blue-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleToggleWorker(worker.id)}
                        disabled={isSending}
                      />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {worker.name}
                          </span>
                          {worker.countryOfOrigin && (
                            <Badge variant="secondary" className="text-xs">
                              {worker.countryOfOrigin}
                            </Badge>
                          )}
                        </div>
                        {worker.jobDescription && (
                          <p className="text-xs text-muted-foreground">
                            {worker.jobDescription}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {worker.email}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
