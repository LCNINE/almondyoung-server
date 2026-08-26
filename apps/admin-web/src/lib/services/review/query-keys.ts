import { ReviewListQuery } from '@/lib/types/dto/review';
import { ReviewStatisticsQuery } from '@/lib/api/domains/review';

export const reviewQueryKeys = {
  all: ['review'] as const,
  list: (query: ReviewListQuery) => [...reviewQueryKeys.all, 'list', query] as const,
  review: (id: string) => [...reviewQueryKeys.all, 'review', id] as const,
  statistics: (query: ReviewStatisticsQuery) => [...reviewQueryKeys.all, 'statistics', query] as const,
} as const;
