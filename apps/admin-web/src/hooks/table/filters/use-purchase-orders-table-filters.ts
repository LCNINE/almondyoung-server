import type { Filter } from '@/components/data-table';

export function usePurchaseOrdersTableFilters(): Filter[] {
  return [
    {
      key: 'status',
      label: '운영 상태',
      type: 'select',
      options: [
        { label: '생성됨', value: 'created' },
        { label: '확정됨', value: 'confirmed' },
        { label: '입고완료', value: 'received' },
      ],
    },
    {
      key: 'type',
      label: '발주 유형',
      type: 'select',
      options: [
        { label: '국내', value: 'domestic' },
        { label: '해외', value: 'foreign' },
      ],
    },
  ];
}
