import Image from "next/image"
import { Button } from "@components/common/ui/button"
import type { WritableReview } from "../../types"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"

interface ReviewCardWritableProps {
  review: WritableReview
  onWriteReview: () => void
}

export const ReviewCardWritable = ({
  review,
  onWriteReview,
}: ReviewCardWritableProps) => {
  const expiresAt = new Date(review.expiresAt)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  expiresAt.setHours(0, 0, 0, 0)

  const diffDays = Math.ceil(
    (expiresAt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  )

  const formattedExpiresAt = new Date(review.expiresAt).toLocaleDateString(
    "ko-KR"
  )

  return (
    <article className="w-full bg-[#FFFFFF]">
      <div className="flex flex-col gap-3 p-4">
        <section className="flex items-start gap-3">
          <figure className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md border border-[#F0F0F0]">
            <Image
              src={getThumbnailUrl(review.productImage)}
              alt={`${review.productName} 썸네일`}
              width={96}
              height={96}
              className="object-cover"
            />
          </figure>

          <div className="flex-1">
            <h3 className="line-clamp-2 text-[15px] leading-[22px] font-bold text-[#1A1A1A]">
              {review.productName}
            </h3>
            <dl className="mt-[2px] flex items-center text-[13px] text-[#666666]">
              <dt>작성 기한 :&nbsp;</dt>
              <dd>{formattedExpiresAt}</dd>
              {diffDays >= 0 && (
                <dd className="ml-1 text-[12px] font-medium text-red-500">
                  (D-{diffDays === 0 ? "Day" : diffDays})
                </dd>
              )}
            </dl>
          </div>
        </section>

        <section className="flex justify-end">
          <Button
            variant="default"
            onClick={onWriteReview}
            className="h-[36px] px-4 text-[14px] font-medium"
          >
            리뷰쓰기
          </Button>
        </section>
      </div>
    </article>
  )
}
