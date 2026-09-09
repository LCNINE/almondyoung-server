import { getRatingSummary } from "@/lib/api/ugc/reviews"
import { Rating } from "../../../components/rating"
import { RatingSummary } from "@/lib/types/ui/ugc"

interface Props {
  /** PIM 마스터 id. PIM 에 없는 상품(예: 렌탈)은 undefined — 그때는 조회하지 않는다 */
  productId: string | undefined
}

export async function RatingActionsWrapper({ productId }: Props) {
  const ratingSummary: RatingSummary | null = productId
    ? await getRatingSummary(productId).catch((e) => {
        console.error(e)
        return null
      })
    : null
  return (
    <Rating
      rating={ratingSummary?.averageRating ?? 0}
      reviewCount={ratingSummary?.totalCount ?? 0}
    />
  )
}
