"use client"

import { Star } from "lucide-react"

type ProductRatingProps = {
  score: number
  reviewCount: number
  className?: string
}

export const ProductRating = ({
  score,
  reviewCount,
  className = "",
}: ProductRatingProps) => {
  if (!score) return null

  return (
    <div className={`flex items-center gap-1 text-xs text-gray-500 ${className}`}>
      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
      <span className="font-semibold text-gray-900">{score}</span>
      <span>({reviewCount.toLocaleString()})</span>
    </div>
  )
}
