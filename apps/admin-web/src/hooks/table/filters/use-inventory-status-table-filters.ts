import type { Filter } from '@/components/data-table';
import { useWarehouses } from '@/lib/services/inventory';

export function useInventoryStatusTableFilters(): Filter[] {
  const { data: warehouses } = useWarehouses();

  const warehouseOptions = (warehouses ?? []).map((w) => ({
    label: w.name,
    value: w.id,
  }));

  return [
    {
      key: 'quantityState',
      label: '재고 상태',
      type: 'select',
      options: [
        { label: '가용재고 없음', value: 'out_of_stock' },
        { label: '예약 있음', value: 'reserved' },
        { label: '입고 예정', value: 'inbound_pending' },
        { label: '출고 예정', value: 'outbound_pending' },
      ],
    },
    {
      key: 'warehouseId',
      label: '창고',
      type: 'select',
      options: warehouseOptions,
    },
  ];
}
