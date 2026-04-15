import type { Filter } from '@/components/data-table';

export function useMembershipMemberTableFilters(): Filter[] {
  return [
    {
      key: 'status',
      label: '활성화 여부',
      type: 'select',
      options: [
        { label: '활성화', value: 'ACTIVE' },
        { label: '일시정지', value: 'PAUSED' },
        { label: '만료', value: 'EXPIRED' },
        { label: '해지', value: 'CANCELLED' },
      ],
    },
    {
      key: 'dateFrom',
      label: '등록일 (시작)',
      type: 'date',
    },
    {
      key: 'dateTo',
      label: '등록일 (종료)',
      type: 'date',
    },
  ];
}
