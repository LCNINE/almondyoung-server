import type { Filter } from '@/components/data-table';

export function useHoldersTableFilters(): Filter[] {
  return [
    {
      key: 'search',
      label: '검색',
      type: 'string',
    },
    {
      key: 'isOurAsset',
      label: '자사 여부',
      type: 'select',
      options: [
        { label: '자사', value: 'true' },
        { label: '위탁', value: 'false' },
      ],
    },
  ];
}
