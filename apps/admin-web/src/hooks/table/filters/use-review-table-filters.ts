import type { Filter } from '@/components/data-table';
import {
  REVIEW_PROVIDER_LABELS,
  HAS_COMMENT_LABELS,
  REVIEW_HAS_COMMENT_OPTIONS,
  REVIEW_RATINGS,
  REVIEW_STATUS_FILTERS,
  STATUS_LABELS,
} from '@/lib/types/dto/review';

export function useReviewTableFilters(): Filter[] {
  return [
    {
      key: 'hasMedia',
      label: '첨부 이미지',
      type: 'select',
      options: [
        { value: 'true', label: '있음' },
        { value: 'false', label: '없음' },
      ],
    },
    {
      key: 'provider',
      label: '작성 권한',
      type: 'select',
      options: Object.entries(REVIEW_PROVIDER_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
    },
    { key: 'batchId', label: '등록 배치 ID', type: 'string' },
    {
      key: 'source',
      label: '리뷰 출처',
      type: 'select',
      options: [
        { value: 'own', label: '자체 작성' },
        { value: 'legacy', label: '이관 리뷰' },
      ],
    },
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
    {
      key: 'createdAt',
      label: '작성일',
      type: 'date',
    },
  ];
}
