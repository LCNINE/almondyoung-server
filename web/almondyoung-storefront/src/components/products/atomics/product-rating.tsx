"use client"

import React from "react"
import { Star } from "lucide-react"

export const ProductRating = ({
  score,
  reviewCount,
}: {
  score?: number
  reviewCount?: number
}) => {
  if (!score) return null
  return (
    <div className="flex items-center gap-0.5">
      <Star className="w-4 h-4 fill-primary" strokeWidth={0} />
      <span className="text-sm font-semibold text-gray-40">{score.toFixed(1)}</span>
      {reviewCount && (
        <span className="text-sm font-light text-gray-40">
          ({reviewCount})
        </span>
      )}
    </div>
  )
}
