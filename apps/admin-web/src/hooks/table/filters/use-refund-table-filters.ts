import type { Filter } from '@/components/data-table';
import { REFUND_KIND_FILTER_OPTIONS } from '@/lib/api/domains/wallet/refund-kind';

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
    {
      key: 'kind',
      label: '종류',
      type: 'select',
      options: REFUND_KIND_FILTER_OPTIONS,
    },
  ];
}
