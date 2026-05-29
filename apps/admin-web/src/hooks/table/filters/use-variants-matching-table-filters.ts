import type { Filter } from '@/components/data-table';

export function useVariantsMatchingTableFilters(): Filter[] {
  return [
    {
      key: 'status',
      label: '원본 상태',
      type: 'select',
      options: [
        { label: 'pending', value: 'pending' },
        { label: 'matched', value: 'matched' },
        { label: 'ignored', value: 'ignored' },
      ],
    },
  ];
}
