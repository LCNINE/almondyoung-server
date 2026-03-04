"use client"

import { ApiAuthError } from "@/lib/api/api-error"
import { toggleReviewReaction } from "@/lib/api/ugc"
import { siteConfig } from "@/lib/config/site"
import { getPathWithoutCountry } from "@/lib/utils/get-path-without-country"
import { useRef, useState } from "react"

type Props = {
  countryCode: string
  reviewId: string
  initialLikeCount: number
}

/**
 * @description '도움이 되었어요' 버튼 및 좋아요 카운트
 */
export function ReviewHelpfulButton({
  countryCode,
  reviewId,
  initialLikeCount,
}: Props) {
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(initialLikeCount)
  const isPending = useRef(false)

  const handleLikeClick = async () => {
    if (isPending.current) return
    isPending.current = true

    const prevLiked = liked

    setLiked(!liked)

    try {
      const result = await toggleReviewReaction(reviewId, { type: "helpful" })

      if (result) {
        setLiked(result.marked)
        setLikeCount(result.count)
      }
    } catch (error) {
      setLiked(prevLiked)

      const message =
        error instanceof ApiAuthError ? error.message : String(error)

      if (message.includes("Unauthorized")) {
        const confirmed = window.confirm(
          "로그인이 필요해요. 로그인 페이지로 이동하시겠어요?"
        )
        if (confirmed) {
          const path = getPathWithoutCountry(countryCode)
          window.location.href = `/${countryCode}${siteConfig.auth.loginUrl}?redirect_to=${encodeURIComponent(path)}`
        }
      }
    } finally {
      isPending.current = false
    }
  }

  return (
    <footer className="flex items-center gap-3 pt-2">
      <button
        type="button"
        onClick={handleLikeClick}
        className={`h-[27px] rounded border bg-white px-2.5 py-1 text-xs transition-colors ${
          liked
            ? "border-amber-600 bg-orange-50 text-orange-600"
            : "border-amber-500 text-orange-500 hover:bg-orange-50"
        }`}
        aria-pressed={liked}
      >
        도움이 되었어요
      </button>
      <p className="flex items-center gap-1 text-xs text-gray-500">
        <span aria-label="좋아요">♥</span> {likeCount}
      </p>
    </footer>
  )
}
