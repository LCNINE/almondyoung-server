import type { Filter } from '@/components/data-table';

export function useFulfillmentsTableFilters(): Filter[] {
  return [
    {
      key: 'status',
      label: '상태',
      type: 'select',
      options: [
        { label: '생성됨', value: 'created' },
        { label: '부분예약', value: 'partially_reserved' },
        { label: '준비됨', value: 'ready' },
        { label: '처리중', value: 'processing' },
        { label: '부분출고', value: 'partially_shipped' },
        { label: '출고완료', value: 'shipped' },
        { label: '완료', value: 'completed' },
        { label: '복구필요', value: 'recovery_required' },
        { label: '취소됨', value: 'canceled' },
      ],
    },
  ];
}
