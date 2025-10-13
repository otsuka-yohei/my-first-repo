import "server-only"

import { env } from "@/server/env"

export interface MedicalFacility {
  name: string
  address: string
  url?: string
  googleMapsUrl: string
  location: {
    lat: number
    lng: number
  }
  openingHours?: {
    openNow: boolean
    weekdayText?: string[]
  }
  rating?: number
  userRatingsTotal?: number
  types?: string[]
  distanceMeters?: number
  travelTimeMinutes?: number
  phoneNumber?: string
  openNow?: boolean
  acceptsForeigners?: boolean
  recommendationReasons?: string[] // 推薦理由のリスト
}

export interface SearchMedicalFacilitiesParams {
  address: string
  symptomType?: string // 例: "内科", "外科", "整形外科", "歯科"
  urgency?: "immediate" | "today" | "this_week" | "flexible"
  radius?: number // メートル単位 (デフォルト: 5000m = 5km)
}

interface GooglePlaceResult {
  name: string
  vicinity?: string
  formatted_address?: string
  place_id: string
  geometry: {
    location: {
      lat: number
      lng: number
    }
  }
  rating?: number
  user_ratings_total?: number
  types?: string[]
  opening_hours?: {
    open_now?: boolean
    weekday_text?: string[]
  }
}

/**
 * Google Places APIを使用して医療機関を検索
 */
export async function searchMedicalFacilities(
  params: SearchMedicalFacilitiesParams
): Promise<MedicalFacility[]> {
  const apiKey = env.GOOGLE_PLACES_API_KEY

  if (!apiKey) {
    console.warn("[medical] GOOGLE_PLACES_API_KEY not configured - medical facility search is disabled")
    console.warn("[medical] To enable this feature, set GOOGLE_PLACES_API_KEY in your .env file")
    // API キーが設定されていない場合は空の配列を返す（エラーにしない）
    return []
  }

  try {
    console.log("[medical] Searching facilities:", params)

    // Step 1: 住所から緯度経度を取得 (Geocoding API)
    const geocodeUrl = new URL("https://maps.googleapis.com/maps/api/geocode/json")
    geocodeUrl.searchParams.set("address", params.address)
    geocodeUrl.searchParams.set("key", apiKey)

    const geocodeResponse = await fetch(geocodeUrl.toString())
    const geocodeData = await geocodeResponse.json()

    if (geocodeData.status !== "OK" || !geocodeData.results?.[0]) {
      console.error("[medical] Geocoding failed:", {
        status: geocodeData.status,
        error_message: geocodeData.error_message,
        address: params.address,
      })

      // ユーザーにわかりやすいエラーメッセージ
      if (geocodeData.status === "ZERO_RESULTS") {
        throw new Error("入力された住所が見つかりませんでした。住所を確認してください。")
      } else if (geocodeData.status === "REQUEST_DENIED") {
        throw new Error("Google Maps APIの設定に問題があります。管理者にお問い合わせください。")
      } else if (geocodeData.status === "OVER_QUERY_LIMIT") {
        throw new Error("検索回数の上限に達しました。しばらく時間をおいて再度お試しください。")
      }
      throw new Error(`住所から位置情報を取得できませんでした（エラー: ${geocodeData.status}）`)
    }

    const location = geocodeData.results[0].geometry.location
    console.log("[medical] Location found:", location)

    // Step 2: 症状タイプから検索キーワードと適切なtypeを決定
    const keyword = determineSearchKeyword(params.symptomType)
    const placeType = determinePlaceType(params.symptomType)

    console.log("[medical] Search parameters:", {
      symptomType: params.symptomType,
      keyword,
      placeType,
      urgency: params.urgency,
    })

    // Step 3: 段階的に検索範囲を広げる（3km → 5km → 10km）
    const searchRadii = params.radius ? [params.radius] : [3000, 5000, 10000] // 明示的に指定されていない場合は段階的検索
    let placesData: any = null
    let usedRadius = 0

    for (const radius of searchRadii) {
      console.log(`[medical] Searching within ${radius}m radius...`)

      // まず、キーワード + type検索を試す
      const placesUrl = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json")
      placesUrl.searchParams.set("location", `${location.lat},${location.lng}`)
      placesUrl.searchParams.set("radius", radius.toString())
      placesUrl.searchParams.set("keyword", keyword || "病院 クリニック 医院")
      // 症状に応じた適切なtypeを設定（歯科の場合はdentist）
      if (placeType) {
        placesUrl.searchParams.set("type", placeType)
      }
      placesUrl.searchParams.set("key", apiKey)
      placesUrl.searchParams.set("language", "ja")

      console.log("[medical] Searching with URL:", placesUrl.toString().replace(apiKey, "***API_KEY***"))

      const placesResponse = await fetch(placesUrl.toString())
      placesData = await placesResponse.json()

      console.log("[medical] Places API response:", {
        radius: `${radius}m`,
        status: placesData.status,
        results_count: placesData.results?.length || 0,
        error_message: placesData.error_message,
      })

      if (placesData.status !== "OK" && placesData.status !== "ZERO_RESULTS") {
        console.error("[medical] Places search failed:", {
          status: placesData.status,
          error_message: placesData.error_message,
          location: `${location.lat},${location.lng}`,
          radius,
          keyword,
        })

        // ユーザーにわかりやすいエラーメッセージ
        if (placesData.status === "REQUEST_DENIED") {
          throw new Error("Google Places APIの設定に問題があります。管理者にお問い合わせください。")
        } else if (placesData.status === "OVER_QUERY_LIMIT") {
          throw new Error("検索回数の上限に達しました。しばらく時間をおいて再度お試しください。")
        } else if (placesData.status === "INVALID_REQUEST") {
          throw new Error("検索パラメータに問題があります。住所を確認してください。")
        }
        throw new Error(`医療機関の検索に失敗しました（エラー: ${placesData.status}）`)
      }

      // 結果が見つかった場合
      if (placesData.status === "OK" && placesData.results?.length > 0) {
        usedRadius = radius
        console.log(`[medical] Found ${placesData.results.length} facilities within ${radius}m`)
        break
      }

      // キーワード検索で見つからない場合、typeのみで再検索
      const fallbackType = placeType || "hospital"
      console.log(`[medical] No facilities found with keyword search at ${radius}m, trying type=${fallbackType} only`)

      const broadSearchUrl = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json")
      broadSearchUrl.searchParams.set("location", `${location.lat},${location.lng}`)
      broadSearchUrl.searchParams.set("radius", radius.toString())
      broadSearchUrl.searchParams.set("type", fallbackType)
      broadSearchUrl.searchParams.set("key", apiKey)
      broadSearchUrl.searchParams.set("language", "ja")

      const broadResponse = await fetch(broadSearchUrl.toString())
      const broadData = await broadResponse.json()

      console.log("[medical] Broad search response:", {
        radius: `${radius}m`,
        status: broadData.status,
        results_count: broadData.results?.length || 0,
      })

      if (broadData.status === "OK" && broadData.results?.length > 0) {
        placesData = broadData
        usedRadius = radius
        console.log(`[medical] Found ${broadData.results.length} facilities with type=hospital at ${radius}m`)
        break
      }

      console.log(`[medical] No facilities found at ${radius}m, trying wider radius...`)
    }

    // すべての検索範囲で見つからなかった場合
    if (!placesData || placesData.status !== "OK" || !placesData.results?.length) {
      console.log("[medical] No facilities found in any search radius (3km, 5km, 10km)")
      return []
    }

    // Step 4: 結果を整形
    const facilities: MedicalFacility[] = placesData.results.map((place: GooglePlaceResult) => {
      const facility: MedicalFacility = {
        name: place.name,
        address: place.vicinity || place.formatted_address || "",
        googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${place.place_id}`,
        location: {
          lat: place.geometry.location.lat,
          lng: place.geometry.location.lng,
        },
        rating: place.rating,
        userRatingsTotal: place.user_ratings_total,
        types: place.types,
      }

      // 営業時間情報
      if (place.opening_hours) {
        facility.openingHours = {
          openNow: place.opening_hours.open_now ?? false,
        }
      }

      // 距離を計算 (簡易的なハバーサイン距離)
      const distance = calculateDistance(
        location.lat,
        location.lng,
        place.geometry.location.lat,
        place.geometry.location.lng
      )
      facility.distanceMeters = Math.round(distance * 1000)
      // 移動時間の概算 (徒歩速度 4km/h)
      facility.travelTimeMinutes = Math.round((distance / 4) * 60)

      return facility
    })

    // Step 5: 緊急度に応じてフィルタリングとソート
    let filteredFacilities = facilities

    if (params.urgency === "immediate") {
      // 今すぐ: 営業中の施設のみ
      filteredFacilities = facilities.filter((f) => f.openingHours?.openNow)
    }

    // 距離順にソート
    filteredFacilities.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))

    // 上位10件に絞る
    const topFacilities = filteredFacilities.slice(0, 10)

    // 各施設に推薦理由を追加
    topFacilities.forEach((facility, index) => {
      facility.recommendationReasons = generateRecommendationReasons(facility, {
        symptomType: params.symptomType,
        urgency: params.urgency,
        isClosest: index === 0, // 最初の施設は最も近い
        rank: index + 1,
      })
    })

    console.log(`[medical] Returning ${topFacilities.length} facilities (searched within ${usedRadius}m radius)`)
    return topFacilities
  } catch (error) {
    // すでに意味のあるエラーメッセージを持つエラーはそのまま再スロー
    if (error instanceof Error && error.message.includes("Google")) {
      console.error("[medical] Search failed:", error.message)
      throw error
    }

    console.error("[medical] Unexpected search error:", error)
    throw new Error("医療機関の検索中に予期しないエラーが発生しました。しばらく時間をおいて再度お試しください。")
  }
}

/**
 * 医療機関の推薦理由を生成
 */
function generateRecommendationReasons(
  facility: MedicalFacility,
  params: {
    symptomType?: string
    urgency?: "immediate" | "today" | "this_week" | "flexible"
    isClosest?: boolean
    rank?: number
  }
): string[] {
  const reasons: string[] = []

  // 距離に基づく理由
  if (params.isClosest) {
    reasons.push("最も近い医療機関です")
  } else if (facility.distanceMeters !== undefined) {
    const distanceKm = (facility.distanceMeters / 1000).toFixed(1)
    if (facility.distanceMeters < 1000) {
      reasons.push(`徒歩圏内（${distanceKm}km）`)
    } else if (facility.distanceMeters < 3000) {
      reasons.push(`比較的近い（${distanceKm}km）`)
    }
  }

  // 営業時間に基づく理由
  const isOpen = facility.openingHours?.openNow ?? facility.openNow
  if (params.urgency === "immediate" && isOpen) {
    reasons.push("現在営業中です")
  } else if (isOpen) {
    reasons.push("営業中")
  }

  // 評価に基づく理由
  if (facility.rating !== undefined) {
    if (facility.rating >= 4.0) {
      reasons.push(`高評価（⭐${facility.rating}）`)
    } else if (facility.rating >= 3.5) {
      reasons.push(`評価良好（⭐${facility.rating}）`)
    }
  }

  // 症状タイプとの関連性
  const types = facility.types || []

  // 歯科の判定
  if (types.some(t => t.includes("dentist"))) {
    reasons.push("歯科医院")
  } else if (types.some(t => t.includes("doctor") || t.includes("clinic"))) {
    reasons.push("クリニック")
  } else if (types.some(t => t.includes("hospital"))) {
    reasons.push("総合病院")
  }

  // 症状タイプとの一致を確認
  if (params.symptomType) {
    const normalized = params.symptomType.toLowerCase()
    if (normalized.includes("歯") && types.some(t => t.includes("dentist"))) {
      reasons.push("症状に適した専門科")
    }
  }

  // 外国人対応
  if (facility.acceptsForeigners) {
    reasons.push("外国人対応可能")
  }

  // レビュー数が多い場合
  if (facility.userRatingsTotal !== undefined && facility.userRatingsTotal > 50) {
    reasons.push(`多くのレビューあり（${facility.userRatingsTotal}件）`)
  }

  // 理由がない場合のデフォルト
  if (reasons.length === 0) {
    if (params.rank !== undefined) {
      reasons.push(`候補${params.rank}`)
    } else {
      reasons.push("近隣の医療機関")
    }
  }

  return reasons
}

/**
 * 症状タイプから適切なGoogle Places APIのtypeを決定
 */
function determinePlaceType(symptomType?: string): string | null {
  if (!symptomType) return "hospital"

  const normalized = symptomType.toLowerCase()

  // 歯科は必ずdentistタイプで検索
  if (normalized.includes("歯") || normalized.includes("歯科")) {
    return "dentist"
  }

  // その他は一般的な病院・医院
  return "hospital"
}

/**
 * 症状タイプから検索キーワードを決定
 */
function determineSearchKeyword(symptomType?: string): string {
  if (!symptomType) return "病院 クリニック"

  const normalized = symptomType.toLowerCase()

  if (normalized.includes("内科") || normalized.includes("風邪") || normalized.includes("発熱")) {
    return "内科 クリニック"
  }
  if (normalized.includes("外科") || normalized.includes("怪我") || normalized.includes("ケガ")) {
    return "外科 整形外科"
  }
  if (normalized.includes("歯") || normalized.includes("歯科")) {
    return "歯科 歯医者"
  }
  if (normalized.includes("皮膚") || normalized.includes("皮膚科")) {
    return "皮膚科"
  }
  if (normalized.includes("耳") || normalized.includes("鼻") || normalized.includes("喉")) {
    return "耳鼻咽喉科"
  }
  if (normalized.includes("眼") || normalized.includes("目")) {
    return "眼科"
  }

  return "病院 クリニック"
}

/**
 * 2点間のハバーサイン距離を計算 (km単位)
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // 地球の半径 (km)
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180)
}
