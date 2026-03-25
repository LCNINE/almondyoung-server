import type { Filter } from '@/components/data-table';

export function useUserTableFilters(): Filter[] {
  return [
    {
      key: 'roleName',
      label: '역할',
      type: 'select',
      options: [
        { label: '관리자', value: 'admin' },
        { label: '마스터', value: 'master' },
        { label: '일반', value: 'user' },
      ],
    },
  ];
}
