import { NextRequest, NextResponse } from "next/server"
import { writeFile } from "fs/promises"
import { join } from "path"
import { randomBytes } from "crypto"

import { auth } from "@/auth"
import { convertToJpeg, isHeicFile } from "@/lib/image-converter"

// 許可する画像形式
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
]
// 最大ファイルサイズ（10MB - HEICファイルを考慮）
const MAX_FILE_SIZE = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json(
        { error: "ファイルが選択されていません" },
        { status: 400 }
      )
    }

    // ファイルサイズチェック
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "ファイルサイズが大きすぎます（最大10MB）" },
        { status: 400 }
      )
    }

    // ファイルタイプチェック
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "サポートされていないファイル形式です" },
        { status: 400 }
      )
    }

    // ファイルデータを取得
    const bytes = await file.arrayBuffer()
    let buffer: Buffer = Buffer.from(bytes)

    // HEICファイルの場合はJPEGに変換
    let extension = file.name.split(".").pop()?.toLowerCase() || "jpg"
    let finalMimeType = file.type

    if (isHeicFile(file.type)) {
      console.log(`[API] Converting HEIC/HEIF to JPEG: ${file.name}`)
      try {
        const converted = await convertToJpeg(buffer, {
          quality: 85,
          maxWidth: 2048,
          maxHeight: 2048,
        })
        buffer = Buffer.from(converted)
        extension = "jpg"
        finalMimeType = "image/jpeg"
        console.log(`[API] Conversion successful. Original size: ${file.size}, New size: ${buffer.length}`)
      } catch (conversionError) {
        console.error("[API] Failed to convert HEIC to JPEG:", conversionError)
        return NextResponse.json(
          { error: "画像の変換に失敗しました" },
          { status: 500 }
        )
      }
    }

    // ファイル名を生成（ランダム文字列 + 拡張子）
    const filename = `${randomBytes(16).toString("hex")}.${extension}`

    // publicディレクトリに保存
    const publicPath = join(process.cwd(), "public", "uploads", filename)
    await writeFile(publicPath, buffer)

    // URLを返す
    const url = `/uploads/${filename}`

    console.log(`[API] File uploaded successfully. URL: ${url}, Original size: ${file.size} bytes, Final size: ${buffer.length} bytes, Type: ${finalMimeType}`)

    return NextResponse.json({ url })
  } catch (error) {
    console.error("Failed to upload file", error)
    return NextResponse.json(
      { error: "ファイルのアップロードに失敗しました" },
      { status: 500 }
    )
  }
}
