import {
  RatingSummaryResponseDto,
  ReviewResponseDto,
} from "@/lib/types/dto/ugc"

interface ReviewDetail extends ReviewResponseDto {}

interface RatingSummary extends RatingSummaryResponseDto {}

export type { ReviewDetail, RatingSummary }
