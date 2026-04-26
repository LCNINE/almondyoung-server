import type { Filter } from '@/components/data-table';
import { useWarehouses } from '@/lib/services/inventory';

export function useTransferJobsTableFilters(): Filter[] {
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
  ];
}
