import type { Filter } from '@/components/data-table';

export function useReturnsTableFilters(): Filter[] {
  return [
    {
      key: 'status',
      label: '상태',
      type: 'select',
      options: [
        { label: '회수 요청', value: 'requested' },
        { label: '입고 완료', value: 'received' },
        { label: 'QC 통과', value: 'qc_passed' },
        { label: 'QC 실패', value: 'qc_failed' },
        { label: '처리 완료', value: 'disposed' },
      ],
    },
  ];
}
