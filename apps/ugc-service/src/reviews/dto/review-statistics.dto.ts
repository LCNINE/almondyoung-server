import { IsCalendarDateConstraint } from '@app/shared';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min, Validate } from 'class-validator';

export class AdminReviewStatisticsQueryDto {
  // 모양만 보는 @Matches 는 '2026-02-31' 을 통과시키고, 그 값은
  // KST 자정 변환의 toISOString() 에서 RangeError(500)로 터진다.
  @Validate(IsCalendarDateConstraint, { message: 'from 은 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  from: string;

  @Validate(IsCalendarDateConstraint, { message: 'to 는 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  to: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit: number = 10;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  lowRatedPage: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  topProductsPage: number = 1;
}

export class ReviewStatisticsRangeDto {
  from: string;
  to: string;
}

export class ReviewStatisticsTotalsDto {
  reviewCount: number;
  /** 직전 동일 길이 기간의 리뷰 수 */
  previousReviewCount: number;
  /** 기간 평균 평점 — 리뷰가 없으면 null */
  averageRating: number | null;
  previousAverageRating: number | null;
  /** 사진이 1장 이상 붙은 리뷰 수 */
  photoReviewCount: number;
  /** 어드민 댓글이 달린 리뷰 수 */
  adminCommentedCount: number;
  /** 기간 내 생긴 리뷰 작성 자격 수 (구매 기반) */
  eligibleCount: number;
  /** 그중 실제 리뷰로 소진된 수 — 리뷰를 지워도 소진 기록은 남는다 */
  consumedEligibleCount: number;
}

export class RatingBucketDto {
  rating: number;
  count: number;
}

export class ReviewVolumeBucketDto {
  /** KST 달력 날짜 (YYYY-MM-DD) */
  bucket: string;
  count: number;
  averageRating: number | null;
}

export class ProductRatingRowDto {
  productId: string;
  reviewCount: number;
  averageRating: number;
}

export class BestReviewDto {
  reviewId: string;
  productId: string;
  rating: number;
  /** 본문 앞부분 (200자) */
  contentExcerpt: string;
  reactionCount: number;
  hasPhoto: boolean;
  createdAt: string;
}

export class AdminReviewStatisticsResponseDto {
  range: ReviewStatisticsRangeDto;
  previousRange: ReviewStatisticsRangeDto;
  totals: ReviewStatisticsTotalsDto;
  /** 1~5점 전부 채워서 내려간다 (없는 점수는 0) */
  ratingDistribution: RatingBucketDto[];
  series: ReviewVolumeBucketDto[];
  /** 저평점 경보 — 기간 평균이 임계 아래인 상품 (평균 오름차순) */
  lowRated: ProductRatingRowDto[];
  lowRatedPage: number;
  lowRatedTotalItems: number;
  /** 기간 내 리뷰가 많이 달린 상품 (리뷰 수 내림차순) */
  topProducts: ProductRatingRowDto[];
  topProductsPage: number;
  topProductsTotalItems: number;
  /** lowRated·topProducts 공통 페이지 크기 */
  limit: number;
  /** 리액션을 받은 리뷰 (리액션 수 내림차순) — 전시 후보 */
  bestReviews: BestReviewDto[];
}
