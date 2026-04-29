import type { Filter } from '@/components/data-table';

export function useVariantsMatchingTableFilters(): Filter[] {
  return [
    {
      key: 'status',
      label: '상태',
      type: 'select',
      options: [
        { label: '매칭 대기', value: 'pending' },
        { label: '매칭 완료', value: 'matched' },
        { label: '무시됨', value: 'ignored' },
      ],
    },
  ];
}
