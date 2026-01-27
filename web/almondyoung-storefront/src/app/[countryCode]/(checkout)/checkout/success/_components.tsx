"use client"

import { Rating } from "@/components/rating"
import { useRating } from "@/components/rating/use-rating-hooks"

export function ReviewPromptCard() {
  const { rating, handleRatingChange } = useRating(0)
  return (
    <section className="w-full max-w-[816px] rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white">
      <div className="flex flex-col items-center gap-4 py-6 sm:gap-6 sm:py-10">
        <h2 className="text-base font-bold text-black sm:text-lg">
          구매 경험이 만족스러웠나요?
        </h2>
        <Rating rating={rating} onChange={handleRatingChange} size={44} />
      </div>
    </section>
  )
}
