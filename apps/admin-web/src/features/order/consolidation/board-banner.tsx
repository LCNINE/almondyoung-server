'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { usePermissionCheck } from '@/hooks/use-permission';
import { useWarehouses } from '@/lib/services/inventory/queries';
import { useConsolidationBoard } from '@/lib/services/orders';
import { defaultWarehouseId } from './board-model';

export function ConsolidationBoardBanner() {
  const { data: warehouses = [] } = useWarehouses();
  const { can } = usePermissionCheck();
  const canRead = can(['fulfillment.shipment.read']);
  const board = useConsolidationBoard(
    canRead ? defaultWarehouseId(warehouses) : ''
  );
  const count = board.data?.groups.length ?? 0;

  if (board.isError || count === 0) {
    return null;
  }

  return (
    <div className="mx-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
      <div>
        <p className="font-semibold">합칠 수 있는 주문이 {count}쌍 있어요</p>
        <p className="text-sm">
          송장을 뽑기 전에 합치면 되돌리는 단계 없이 바로 끝나요.
        </p>
      </div>
      <Button asChild>
        <Link href="/order/consolidation">확인하기</Link>
      </Button>
    </div>
  );
}
