import type { Filter } from '@/components/data-table';

export function useTopNoticesTableFilters(): Filter[] {
  return [
    {
      key: 'isActive',
      label: '노출 사용',
      type: 'select',
      options: [
        { label: '사용', value: 'true' },
        { label: '미사용', value: 'false' },
      ],
    },
    {
      key: 'q',
      label: '문구',
      type: 'string',
    },
  ];
}
