import { reviewApi } from '@/lib/api/domains/review';
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

export const useReview = (id: string) => {
  return useSuspenseQuery({
    queryKey: reviewQueryKeys.review(id),
    queryFn: () => reviewApi.getReview(id),
    staleTime: 30 * 1000,
  });
};
