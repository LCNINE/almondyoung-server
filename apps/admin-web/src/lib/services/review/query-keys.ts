import { ReviewListQuery } from '@/lib/types/dto/review';

export const reviewQueryKeys = {
  all: ['review'] as const,
  list: (query: ReviewListQuery) => [...reviewQueryKeys.all, 'list', query] as const,
  review: (id: string) => [...reviewQueryKeys.all, 'review', id] as const,
} as const;
