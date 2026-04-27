import type { Filter } from '@/components/data-table';
import { useSupplierFilterOptions } from '@/lib/services/inventory';

export function useSuppliersTableFilters(): Filter[] {
  const { data: filterOptions } = useSupplierFilterOptions();

  const categoryOptions = (filterOptions?.categories ?? []).map((c) => ({
    label: c.label,
    value: c.value,
  }));

  const managerOptions = (filterOptions?.managers ?? []).map((m) => ({
    label: m.label,
    value: m.value,
  }));

  return [
    {
      key: 'search',
      label: '검색',
      type: 'string',
    },
    {
      key: 'categoryId',
      label: '분류',
      type: 'select',
      options: categoryOptions,
    },
    {
      key: 'purchaseManagerId',
      label: '담당자',
      type: 'select',
      options: managerOptions,
    },
  ];
}
