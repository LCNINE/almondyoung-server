import type { Filter } from '@/components/data-table';
import {
  CATEGORY_LABELS,
  SOURCE_LABELS,
  QUESTION_CATEGORIES,
  QUESTION_SOURCES,
} from '@/lib/types/dto/qna';

export function useQnaTableFilters(): Filter[] {
  return [
    {
      key: 'source',
      label: '출처',
      type: 'select',
      options: QUESTION_SOURCES.map((source) => ({
        label: SOURCE_LABELS[source],
        value: source,
      })),
    },
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
      key: 'createdAt',
      label: '문의일',
      type: 'date',
    },
  ];
}
