"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ApiAuthError } from "@/lib/api/api-error"
import { toggleReviewReaction } from "@/lib/api/ugc"
import { siteConfig } from "@/lib/config/site"
import { getPathWithoutCountry } from "@/lib/utils/get-path-without-country"
import { Heart } from "lucide-react"
import { useRef, useState } from "react"
import { useTranslations } from "next-intl"

type Props = {
  countryCode: string
  reviewId: string
  initialLikeCount: number
}

export function ReviewHelpfulButton({
  countryCode,
  reviewId,
  initialLikeCount,
}: Props) {
  const t = useTranslations("productDetail.review")
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

      if (
        message.includes("Unauthorized") ||
        message.includes("UNAUTHORIZED")
      ) {
        const confirmed = window.confirm(t("loginRequired"))
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
      <Button
        variant="outline"
        size="sm"
        onClick={handleLikeClick}
        aria-pressed={liked}
        className={cn(
          "h-7 px-3 text-xs font-normal transition-colors",
          liked
            ? "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-600"
            : "text-muted-foreground hover:border-rose-200 hover:text-rose-500"
        )}
      >
        {t("helpful")}
      </Button>

      <span className="text-muted-foreground flex items-center gap-1 text-xs">
        <Heart
          className={cn(
            "h-3 w-3 transition-colors",
            liked ? "fill-rose-500 text-rose-500" : "text-muted-foreground"
          )}
        />
        {likeCount}
      </span>
    </footer>
  )
}
