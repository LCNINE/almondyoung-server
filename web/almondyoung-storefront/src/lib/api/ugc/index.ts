import { PaginatedResponseDto } from "@/lib/types/common/pagination"
import { ReviewResponseDto } from "@/lib/types/dto/ugc"
import { ReviewRatingFilter } from "@/lib/types/ui/ugc"
import { api } from "../api"

export const getReviewsByProductId = async ({
  productId,
  rating,
  page,
  limit,
}: {
  productId: string
  rating?: ReviewRatingFilter
  page?: number
  limit?: number
}): Promise<PaginatedResponseDto<ReviewResponseDto>> => {
  const query = {
    productId,
    rating,
    page,
    limit,
  }

  return await api<PaginatedResponseDto<ReviewResponseDto>>(
    "ugc",
    `/reviews/?query=${query}`,
    {
      method: "GET",
      withAuth: false,
    }
  )
}
