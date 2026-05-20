import type { Filter } from '@/components/data-table';
import {
  HAS_COMMENT_LABELS,
  REVIEW_HAS_COMMENT_OPTIONS,
  REVIEW_RATINGS,
  REVIEW_STATUS_FILTERS,
  STATUS_LABELS,
} from '@/lib/types/dto/review';

export function useReviewTableFilters(): Filter[] {
  return [
    {
      key: 'status',
      label: '상태',
      type: 'select',
      options: REVIEW_STATUS_FILTERS.map((status) => ({
        label: STATUS_LABELS[status],
        value: status,
      })),
    },
    {
      key: 'rating',
      label: '별점',
      type: 'select',
      options: REVIEW_RATINGS.map((rating) => ({
        label: `${rating}점`,
        value: rating,
      })),
    },
    {
      key: 'hasComment',
      label: '어드민 답글',
      type: 'select',
      options: REVIEW_HAS_COMMENT_OPTIONS.map((option) => ({
        label: HAS_COMMENT_LABELS[option],
        value: option,
      })),
    },
    {
      key: 'productId',
      label: '상품 ID',
      type: 'string',
    },
  ];
}
