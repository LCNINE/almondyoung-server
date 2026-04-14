import type { Filter } from '@/components/data-table';

export function useCategoryTableFilters(): Filter[] {
  return [
    {
      key: 'isActive',
      label: '상태',
      type: 'select',
      options: [
        { label: '활성', value: 'true' },
        { label: '비활성', value: 'false' },
      ],
    },
  ];
}
