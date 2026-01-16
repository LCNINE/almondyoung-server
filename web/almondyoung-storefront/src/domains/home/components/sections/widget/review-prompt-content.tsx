"use client"

import { Button } from "@/components/ui/button"
import testImage from "@/assets/images/test.png"
import Image from "next/image"
import { useRating } from "@/components/rating/use-rating-hooks"
import { Rating } from "@/components/rating"

export function ReviewPromptContent() {
  const { rating, handleRatingChange } = useRating(0)

  return (
    <div className="flex gap-4">
      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md bg-gray-100">
        <Image
          src={testImage}
          alt="product"
          className="object-cover"
          width={44}
          height={44}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div>
          15초안에 리뷰를 남겨보세요! (적립금50원) <br />
          포토 리뷰 작성시 150원 적립
        </div>

        <div className="flex flex-col items-start gap-2">
          <Rating rating={rating} onChange={handleRatingChange} size={28} />

          <Button className="bg-yellow-30 flex-1 cursor-pointer text-white">
            리뷰 남기기
          </Button>
        </div>
      </div>
    </div>
  )
}
