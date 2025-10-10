import { NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { z } from "zod"

import { auth } from "@/auth"
import { env } from "@/server/env"

const COMPLIANCE_API_KEY = env.GOOGLE_COMPLIANCE_API_KEY

const checkSchema = z.object({
  message: z.string().min(1),
})

export type ComplianceRiskLevel = "none" | "medium" | "high"

export type ComplianceCheckResponse = {
  riskLevel: ComplianceRiskLevel
  reason?: string
}

export async function POST(req: NextRequest) {
  const session = await auth()

  console.log("[compliance] Session check:", session ? "Session found" : "No session", session?.user?.role)

  if (!session?.user) {
    console.error("[compliance] Unauthorized: No session or user")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // GOOGLE_COMPLIANCE_API_KEYが設定されていない場合はチェックをスキップ
  if (!COMPLIANCE_API_KEY) {
    console.warn("GOOGLE_COMPLIANCE_API_KEY is not set. Skipping compliance check.")
    return NextResponse.json(
      { riskLevel: "none", reason: "API key not configured" } as ComplianceCheckResponse,
      { status: 200 }
    )
  }

  // マネージャー以上の権限を持つユーザーのみチェック対象
  if (session.user.role === "WORKER") {
    return NextResponse.json(
      { riskLevel: "none" } as ComplianceCheckResponse,
      { status: 200 }
    )
  }

  const json = await req.json()
  const parsed = checkSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  const { message } = parsed.data

  try {
    const genAI = new GoogleGenerativeAI(COMPLIANCE_API_KEY)
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" })

    const prompt = `あなたはコンプライアンスチェックの専門家です。以下のメッセージがマネージャーからメンバーへ送信される際のコンプライアンスリスクを判定してください。

メッセージ:
"""
${message}
"""

以下の観点でリスクを判定してください：
- パワーハラスメント（威圧的な言動、人格否定、過度な要求など）
- セクシャルハラスメント（性的な言動、不適切な発言など）
- その他のハラスメント（差別的発言、プライバシー侵害など）
- 不適切な言葉遣いや表現

リスクレベルを以下の3段階で判定してください：
- high: 明確なハラスメントまたは重大なコンプライアンス違反の可能性が高い
- medium: 不適切な表現や誤解を招く可能性があり、注意が必要
- none: 問題なし

必ず以下のJSON形式で回答してください：
{
  "riskLevel": "high" | "medium" | "none",
  "reason": "リスクがある場合のみ、具体的な理由を簡潔に説明"
}

理由は日本語で記述し、具体的かつ簡潔に（100文字以内）してください。`

    const result = await model.generateContent(prompt)
    const response = result.response
    const text = response.text()

    // JSONを抽出
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("Failed to parse LLM response")
    }

    const complianceResult = JSON.parse(jsonMatch[0]) as ComplianceCheckResponse

    return NextResponse.json(complianceResult)
  } catch (error) {
    console.error("Failed to check compliance risk", error)
    return NextResponse.json(
      { error: "Unable to check compliance risk" },
      { status: 500 }
    )
  }
}
