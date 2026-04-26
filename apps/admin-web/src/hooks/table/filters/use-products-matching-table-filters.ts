import type { Filter } from '@/components/data-table';

export function useProductsMatchingTableFilters(): Filter[] {
  return [
    {
      key: 'status',
      label: '상태',
      type: 'select',
      options: [
        { label: '활성', value: 'active' },
        { label: '비활성', value: 'inactive' },
        { label: '임시저장', value: 'draft' },
      ],
    },
  ];
}
