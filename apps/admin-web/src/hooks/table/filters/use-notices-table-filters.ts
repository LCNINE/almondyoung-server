import type { Filter } from '@/components/data-table';

export function useNoticesTableFilters(): Filter[] {
  return [
    {
      key: 'category',
      label: '분류',
      type: 'string',
    },
  ];
}
