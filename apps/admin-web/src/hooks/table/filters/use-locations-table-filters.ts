import type { Filter } from '@/components/data-table';
import { useLocationColumns } from '@/lib/services/inventory';

type UseLocationsTableFiltersProps = {
  warehouseId: string;
};

export function useLocationsTableFilters({ warehouseId }: UseLocationsTableFiltersProps): Filter[] {
  const { data: columns } = useLocationColumns(warehouseId);

  const columnOptions = (columns ?? []).map((c) => ({
    label: c.columnName,
    value: c.columnName,
  }));

  return [
    {
      key: 'search',
      label: '검색',
      type: 'string',
    },
    {
      key: 'type',
      label: '타입',
      type: 'select',
      options: [
        { label: '표준', value: 'standard' },
        { label: '구역', value: 'zone' },
      ],
    },
    {
      key: 'columnName',
      label: '열',
      type: 'select',
      options: columnOptions,
    },
    {
      key: 'isActive',
      label: '상태',
      type: 'select',
      options: [
        { label: '활성', value: 'true' },
        { label: '비활성', value: 'false' },
      ],
    },
  ];
}
