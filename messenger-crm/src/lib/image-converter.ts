import sharp from "sharp"

/**
 * 画像をJPEGに変換し、最適化する
 * @param buffer 元の画像データ
 * @param options 変換オプション
 * @returns 変換後のJPEGデータ
 */
export async function convertToJpeg(
  buffer: Buffer,
  options: {
    quality?: number
    maxWidth?: number
    maxHeight?: number
  } = {}
) {
  const { quality = 85, maxWidth = 2048, maxHeight = 2048 } = options

  let pipeline = sharp(buffer)

  // メタデータを取得してサイズをチェック
  const metadata = await pipeline.metadata()

  // 画像が大きすぎる場合はリサイズ
  if (metadata.width && metadata.height) {
    if (metadata.width > maxWidth || metadata.height > maxHeight) {
      pipeline = pipeline.resize(maxWidth, maxHeight, {
        fit: "inside",
        withoutEnlargement: true,
      })
    }
  }

  // JPEGに変換
  const converted = await pipeline
    .jpeg({
      quality,
      progressive: true,
      mozjpeg: true,
    })
    .toBuffer()

  return converted
}

/**
 * HEICファイルかどうかを判定
 */
export function isHeicFile(mimeType: string): boolean {
  return mimeType === "image/heic" || mimeType === "image/heif"
}

/**
 * 変換が必要な画像形式かどうかを判定
 */
export function needsConversion(mimeType: string): boolean {
  // HEIC/HEIF、または巨大なPNGファイルなどは変換対象
  return isHeicFile(mimeType)
}
