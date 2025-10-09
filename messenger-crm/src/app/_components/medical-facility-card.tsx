"use client"

import { ExternalLink, MapPin, Clock, Star, Navigation } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

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

export interface MedicalFacilityCardProps {
  facility: MedicalFacility
}

export function MedicalFacilityCard({ facility }: MedicalFacilityCardProps) {
  const distanceKm = facility.distanceMeters ? (facility.distanceMeters / 1000).toFixed(1) : null
  const travelTime = facility.travelTimeMinutes

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-base font-semibold">{facility.name}</CardTitle>
            {facility.rating && (
              <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                <span className="font-medium">{facility.rating.toFixed(1)}</span>
                {facility.userRatingsTotal && (
                  <span className="text-xs">({facility.userRatingsTotal}件)</span>
                )}
              </div>
            )}
          </div>
          {facility.openingHours?.openNow !== undefined && (
            <Badge variant={facility.openingHours.openNow ? "default" : "secondary"}>
              {facility.openingHours.openNow ? "営業中" : "営業時間外"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 住所 */}
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">{facility.address}</span>
        </div>

        {/* 距離と移動時間 */}
        {(distanceKm || travelTime) && (
          <div className="flex items-center gap-2 text-sm">
            <Navigation className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">
              {distanceKm && `約${distanceKm}km`}
              {distanceKm && travelTime && " ・ "}
              {travelTime && `徒歩約${travelTime}分`}
            </span>
          </div>
        )}

        {/* アクションボタン */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="default"
            size="sm"
            className="flex-1"
            asChild
          >
            <a
              href={facility.googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1"
            >
              <MapPin className="h-3.5 w-3.5" />
              地図を見る
            </a>
          </Button>
          {facility.url && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              asChild
            >
              <a
                href={facility.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                詳細
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export interface MedicalFacilitiesListProps {
  facilities: MedicalFacility[]
  title?: string
}

export function MedicalFacilitiesList({ facilities, title }: MedicalFacilitiesListProps) {
  if (!facilities || facilities.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {title && (
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
      )}
      <div className="space-y-2">
        {facilities.map((facility, index) => (
          <MedicalFacilityCard key={index} facility={facility} />
        ))}
      </div>
    </div>
  )
}
