"use client"

import { useState } from "react"

type Props = {
  initialLikeCount: number
  onLike?: (liked: boolean) => void
}

/**
 * @description '도움이 되었어요' 버튼 및 좋아요 카운트
 * 컴포넌트 내부에 '좋아요' 상태를 두어 독립적으로 동작
 */
export function ReviewHelpfulButton({ initialLikeCount, onLike }: Props) {
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(initialLikeCount)

  const handleLikeClick = () => {
    const newLiked = !liked
    setLiked(newLiked)
    setLikeCount(newLiked ? likeCount + 1 : likeCount - 1)
    onLike?.(newLiked)
  }

  return (
    <footer className="flex items-center gap-3 pt-2">
      <button
        type="button"
        onClick={handleLikeClick}
        className={`h-[27px] rounded border bg-white px-2.5 py-1 text-xs transition-colors ${
          liked
            ? "border-orange-600 bg-orange-50 text-orange-600"
            : "border-orange-500 text-orange-500 hover:bg-orange-50"
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
