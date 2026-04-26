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
      key: 'groupId',
      label: 'SKU 그룹',
      type: 'select',
      options: groupOptions,
    },
  ];
}
