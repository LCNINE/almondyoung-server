import { getRatingSummary } from "@/lib/api/ugc/reviews"
import { Rating } from "../../../components/rating"
import { RatingSummary } from "@/lib/types/ui/ugc"

interface Props {
  productId: string
}

export async function RatingActionsWrapper({ productId }: Props) {
  const ratingSummary: RatingSummary | null = await getRatingSummary(
    productId
  ).catch((e) => {
    console.error(e)
    return null
  })
  return (
    <Rating
      rating={ratingSummary?.averageRating ?? 0}
      reviewCount={ratingSummary?.totalCount ?? 0}
    />
  )
}
