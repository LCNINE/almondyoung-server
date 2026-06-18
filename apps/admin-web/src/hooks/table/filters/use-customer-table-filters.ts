import type { Filter } from '@/components/data-table';

export function useCustomerTableFilters(): Filter[] {
  return [
    {
      key: 'roleName',
      label: '등급',
      type: 'select',
      options: [
        { label: '관리자', value: 'admin' },
        { label: '슈퍼계정', value: 'master' },
        { label: '일반회원', value: 'user' },
      ],
    },
  ];
}
