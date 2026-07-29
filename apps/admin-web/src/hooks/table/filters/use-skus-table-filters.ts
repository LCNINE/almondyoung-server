import type { Filter } from '@/components/data-table';
import { useSkuGroups } from '@/lib/services/inventory';

export function useSkusTableFilters(): Filter[] {
  const { data: groups } = useSkuGroups();

  const groupOptions = (groups ?? []).map((g) => ({
    label: g.name,
    value: g.id,
  }));

  return [
    {
      key: 'name',
      label: 'SKU명',
      type: 'string',
    },
    {
      key: 'code',
      label: 'SKU 코드',
      type: 'string',
    },
    {
      key: 'barcode',
      label: '바코드',
      type: 'string',
    },
    {
      key: 'supplierName',
      label: '공급사',
      type: 'string',
    },
    {
      key: 'groupId',
      label: 'SKU 그룹',
      type: 'select',
      options: groupOptions,
    },
  ];
}
