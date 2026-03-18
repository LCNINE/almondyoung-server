import type { Filter } from '@/components/data-table';

export function useRefundTableFilters(): Filter[] {
  return [
    {
      key: 'status',
      label: '상태',
      type: 'select',
      options: [
        { label: '대기', value: 'PENDING' },
        { label: '완료', value: 'SUCCEEDED' },
        { label: '실패', value: 'FAILED' },
      ],
    },
  ];
}
