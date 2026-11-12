'use client';

import { Badge } from '@/components/ui/badge';
import { defaultWarehouseId } from '@/features/order/consolidation/board-model';
import { usePermissionCheck } from '@/hooks/use-permission';
import { useWarehouses } from '@/lib/services/inventory/queries';
import {
  useConsolidationBoard,
  useOutboundPreparationSummary,
} from '@/lib/services/orders';

// 화면이 처음 여는 창고와 같은 창고를 센다. 같은 쿼리 키라 화면과 캐시를 나눠 쓴다.
function useDefaultShipmentWarehouse() {
  const { data: warehouses = [] } = useWarehouses();
  const { can } = usePermissionCheck();

  return can(['fulfillment.shipment.read'])
    ? defaultWarehouseId(warehouses)
    : '';
}

function CountBadge({ count, label }: { count: number; label: string }) {
  if (count === 0) return null;

  return (
    <Badge
      variant="secondary"
      className="ml-auto text-xs group-data-[collapsible=icon]:hidden"
      aria-label={`${label} ${count}건`}
    >
      {count}
    </Badge>
  );
}

// 출고불가(재고 없음)는 이 화면에서 처리할 수 없어 세지 않는다
export function OutboundPreparationMenuBadge() {
  const summary = useOutboundPreparationSummary(useDefaultShipmentWarehouse());
  const count = (summary.data?.buckets ?? [])
    .filter((bucket) => bucket.bucket !== 'unavailable')
    .reduce((sum, bucket) => sum + bucket.count, 0);

  return <CountBadge count={count} label="출고 준비 대기" />;
}

export function ConsolidationMenuBadge() {
  const board = useConsolidationBoard(useDefaultShipmentWarehouse());

  return (
    <CountBadge
      count={board.data?.groups.length ?? 0}
      label="합칠 수 있는 주문"
    />
  );
}
