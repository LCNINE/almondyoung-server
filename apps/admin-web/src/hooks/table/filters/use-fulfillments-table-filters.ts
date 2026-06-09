import type { Filter } from '@/components/data-table';

export function useFulfillmentsTableFilters(): Filter[] {
  return [
    {
      key: 'status',
      label: '상태',
      type: 'select',
      options: [
        { label: '생성됨', value: 'created' },
        { label: '준비됨', value: 'ready' },
        { label: '대기', value: 'pending' },
        { label: '배치할당', value: 'allocated' },
        { label: '피킹중', value: 'picking' },
        { label: '피킹완료', value: 'picked' },
        { label: '검수중', value: 'inspecting' },
        { label: '검수완료', value: 'inspected' },
        { label: '송장발행', value: 'invoiced' },
        { label: '출고완료', value: 'shipped' },
        { label: '완료', value: 'completed' },
        { label: '취소됨', value: 'canceled' },
      ],
    },
  ];
}
