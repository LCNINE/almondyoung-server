"use client"

import React from "react"
import { Star } from "lucide-react"

export const ProductRating = ({
  rating,
  reviewCount,
}: {
  rating?: number
  reviewCount: number
}) => {
  if (!rating || reviewCount <= 0) return null
  const clampedRating = Math.max(0, Math.min(5, rating))
  const roundedRating = Math.round(clampedRating * 2) / 2

  return (
    <div
      className="mt-1 flex items-center gap-0.5"
      aria-label={`평점 ${clampedRating.toFixed(1)}점, 리뷰 ${reviewCount.toLocaleString()}개`}
    >
      {Array.from({ length: 5 }).map((_, index) => {
        const fillPercent = Math.max(
          0,
          Math.min(100, (roundedRating - index) * 100)
        )

        return (
          <span key={index} className="relative h-3 w-3">
            <Star
              className="absolute h-3 w-3 fill-gray-200 text-gray-200"
              aria-hidden="true"
            />
            {fillPercent > 0 && (
              <span
                className="absolute block h-3 overflow-hidden"
                style={{ width: `${fillPercent}%` }}
                aria-hidden="true"
              >
                <Star className="fill-primary text-primary h-3 w-3" />
              </span>
            )}
          </span>
        )
      })}
      <span className="ml-[3px] text-[10px] leading-none font-medium tracking-[-0.1px] text-gray-30">
        ({reviewCount.toLocaleString()})
      </span>
    </div>
  )
}
