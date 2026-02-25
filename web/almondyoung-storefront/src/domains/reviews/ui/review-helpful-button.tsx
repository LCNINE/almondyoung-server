"use client"

import { useRef, useState } from "react"

type Props = {
  initialLikeCount: number
  onLike?: (liked: boolean) => Promise<{ count: number }> | void
}

/**
 * @description '도움이 되었어요' 버튼 및 좋아요 카운트
 */
export function ReviewHelpfulButton({ initialLikeCount, onLike }: Props) {
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(initialLikeCount)
  const isPending = useRef(false)

  const handleLikeClick = async () => {
    if (isPending.current) return
    isPending.current = true

    const prevLiked = liked
    const prevCount = likeCount
    const newLiked = !liked

    setLiked(newLiked)
    setLikeCount(newLiked ? prevCount + 1 : prevCount - 1)

    try {
      const result = await onLike?.(newLiked)

      if (result && typeof result.count === "number") {
        setLikeCount(result.count)
      }
    } catch {
      // 실패 시 롤백
      setLiked(prevLiked)
      setLikeCount(prevCount)
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
