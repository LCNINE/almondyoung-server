import type { Filter } from '@/components/data-table';

export function useBannerGroupsTableFilters(): Filter[] {
  return [
    {
      key: 'category',
      label: '카테고리',
      type: 'string',
    },
  ];
}
