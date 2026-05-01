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
  if (!rating) return null
  return (
    <div className="mt-1 flex items-center gap-1">
      <Star className="h-3 w-3 fill-[#F2994A] text-[#F2994A]" />
      <span className="text-[12px] font-bold text-gray-900">{rating}</span>
      <span className="text-[12px] text-gray-400">
        ({reviewCount.toLocaleString()})
      </span>
    </div>
  )
}
