import { ratingSummaryApi, reviewApi, reviewStatisticsApi, ReviewStatisticsQuery } from '@/lib/api/domains/review';
import { ReviewListQuery } from '@/lib/types/dto/review';
import {
  keepPreviousData,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { reviewQueryKeys } from './query-keys';

export const useReviews = (query: ReviewListQuery) => {
  return useQuery({
    queryKey: reviewQueryKeys.list(query),
    queryFn: () => reviewApi.getReviews(query),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
};

export const useReviewStatistics = (query: ReviewStatisticsQuery) => {
  return useQuery({
    queryKey: reviewQueryKeys.statistics(query),
    queryFn: () => reviewStatisticsApi.getStatistics(query),
    // 페이지 이동 시 이전 페이지를 유지해 테이블이 깜빡이지 않게 한다
    placeholderData: (previous) => previous,
  });
};

export const useReview = (id: string) => {
  return useSuspenseQuery({
    queryKey: reviewQueryKeys.review(id),
    queryFn: () => reviewApi.getReview(id),
    staleTime: 30 * 1000,
  });
};

/** 상품 하나의 평점 요약(전 기간 누적). productId 는 PIM masterId 다. */
export const useProductRatingSummary = (productId: string) => {
  return useQuery({
    queryKey: reviewQueryKeys.ratingSummary(productId),
    queryFn: () => ratingSummaryApi.getByProductId(productId),
    enabled: Boolean(productId),
  });
};
