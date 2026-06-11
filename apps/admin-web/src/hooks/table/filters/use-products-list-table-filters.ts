import type { Filter } from '@/components/data-table';

export function useProductsListTableFilters(): Filter[] {
  return [
    // GET /masters 는 status 필터 대신 mode 를 노출한다.
    // active(기본): active 버전만 / active-or-inactive: active 우선, 없으면 최신 inactive 포함
    // / all: draft만 있는 작성 중 상품까지 포함.
    {
      key: 'mode',
      label: '판매 상태',
      type: 'select',
      options: [
        { label: '판매중', value: 'active' },
        { label: '판매중단 포함', value: 'active-or-inactive' },
        { label: '작성중(임시) 포함', value: 'all' },
      ],
    },
  ];
}
