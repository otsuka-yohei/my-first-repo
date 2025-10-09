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
}

export interface SearchMedicalFacilitiesParams {
  address: string
  symptomType?: string // 例: "内科", "外科", "整形外科", "歯科"
  urgency?: "immediate" | "today" | "this_week" | "flexible"
  radius?: number // メートル単位 (デフォルト: 5000m = 5km)
}

/**
 * Google Places APIを使用して医療機関を検索
 */
export async function searchMedicalFacilities(
  params: SearchMedicalFacilitiesParams
): Promise<MedicalFacility[]> {
  const apiKey = env.GOOGLE_PLACES_API_KEY

  if (!apiKey) {
    console.error("[medical] GOOGLE_PLACES_API_KEY not configured")
    throw new Error("医療機関検索機能が設定されていません")
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
      console.error("[medical] Geocoding failed:", geocodeData.status)
      throw new Error("住所から位置情報を取得できませんでした")
    }

    const location = geocodeData.results[0].geometry.location
    console.log("[medical] Location found:", location)

    // Step 2: 症状タイプから検索キーワードを決定
    const keyword = determineSearchKeyword(params.symptomType)
    const radius = params.radius ?? 5000

    // Step 3: Places API Nearby Searchで医療機関を検索
    const placesUrl = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json")
    placesUrl.searchParams.set("location", `${location.lat},${location.lng}`)
    placesUrl.searchParams.set("radius", radius.toString())
    placesUrl.searchParams.set("type", "hospital") // or "doctor"
    if (keyword) {
      placesUrl.searchParams.set("keyword", keyword)
    }
    placesUrl.searchParams.set("key", apiKey)
    placesUrl.searchParams.set("language", "ja")

    const placesResponse = await fetch(placesUrl.toString())
    const placesData = await placesResponse.json()

    if (placesData.status !== "OK" && placesData.status !== "ZERO_RESULTS") {
      console.error("[medical] Places search failed:", placesData.status)
      throw new Error("医療機関の検索に失敗しました")
    }

    if (placesData.status === "ZERO_RESULTS" || !placesData.results?.length) {
      console.log("[medical] No facilities found")
      return []
    }

    // Step 4: 結果を整形
    const facilities: MedicalFacility[] = placesData.results.map((place: any) => {
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

    console.log(`[medical] Found ${topFacilities.length} facilities`)
    return topFacilities
  } catch (error) {
    console.error("[medical] Search failed:", error)
    throw new Error("医療機関の検索中にエラーが発生しました")
  }
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
    return "歯科"
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
