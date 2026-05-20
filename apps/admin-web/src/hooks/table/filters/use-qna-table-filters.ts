import type { Filter } from '@/components/data-table';
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  QUESTION_CATEGORIES,
  QUESTION_STATUS_FILTERS,
} from '@/lib/types/dto/qna';

export function useQnaTableFilters(): Filter[] {
  return [
    {
      key: 'category',
      label: '카테고리',
      type: 'select',
      options: QUESTION_CATEGORIES.map((cat) => ({
        label: CATEGORY_LABELS[cat],
        value: cat,
      })),
    },
    {
      key: 'status',
      label: '상태',
      type: 'select',
      options: QUESTION_STATUS_FILTERS.map((status) => ({
        label: STATUS_LABELS[status],
        value: status,
      })),
    },
  ];
}
