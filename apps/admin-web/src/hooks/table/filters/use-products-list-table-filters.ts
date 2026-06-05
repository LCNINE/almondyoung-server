import type { Filter } from '@/components/data-table';

export function useProductsListTableFilters(): Filter[] {
  return [
    // GET /masters currently exposes mode/q filters, not a status filter.
    // {
    //   key: 'status',
    //   label: '상태',
    //   type: 'select',
    //   options: [
    //     { label: '활성', value: 'active' },
    //     { label: '판매중단', value: 'inactive' },
    //     { label: '임시저장', value: 'draft' },
    //     { label: '보관', value: 'archived' },
    //   ],
    // },
  ];
}
