import type { Filter } from '@/components/data-table';
import { useWarehouses } from '@/lib/services/inventory';

const STATUS_OPTIONS = [
  { label: '초안', value: 'draft' },
  { label: '진행 중', value: 'in_progress' },
  { label: '완료', value: 'completed' },
];

export function useStocktakingTableFilters(): Filter[] {
  const { data: warehouses } = useWarehouses();

  const warehouseOptions = (warehouses ?? []).map((w) => ({
    label: w.name,
    value: w.id,
  }));

  return [
    {
      key: 'warehouseId',
      label: '창고',
      type: 'select',
      options: warehouseOptions,
    },
    {
      key: 'status',
      label: '상태',
      type: 'select',
      options: STATUS_OPTIONS,
    },
  ];
}
