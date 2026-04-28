import type { Filter } from '@/components/data-table';

export function useInboundHistoryTableFilters(): Filter[] {
  return [
    {
      key: 'method',
      label: '입고 방식',
      type: 'select',
      options: [
        { label: '개별입고', value: 'individual' },
        { label: '간편입고', value: 'simple' },
        { label: '전수조사', value: 'simple_fullscan' },
        { label: '예정입고', value: 'planned' },
      ],
    },
  ];
}
