'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useStockHistory, useCancelStockEvent } from '@/lib/services/inventory';
import type {
  StockHistoryDto,
  StockSummaryDto,
} from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  row: StockSummaryDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const TRANSITION_TYPE_LABELS: Record<string, string> = {
  RECEIVE: '입고',
  SHIP: '출고',
  MOVE: '이동',
  MARK_DEFECT: '불량 지정',
  REWORK_GOOD: '양품화',
  SCRAP: '폐기',
  ADJUST_UP: '조정(증가)',
  ADJUST_DOWN: '조정(감소)',
};

// 해당 창고 관점의 수량 변화: 들어오면 +, 나가면 −, 창고 내 전환(이동/불량 지정 등)은 0
function deltaForWarehouse(
  item: StockHistoryDto,
  warehouseId?: string
): number {
  if (!warehouseId) return item.quantity;
  const inbound = item.toWarehouseId === warehouseId;
  const outbound = item.fromWarehouseId === warehouseId;
  if (inbound && !outbound) return item.quantity;
  if (outbound && !inbound) return -item.quantity;
  return 0;
}

export function StockHistoryDrawer({ row, open, onOpenChange }: Props) {
  const { data: history, isLoading } = useStockHistory({
    skuId: row?.skuId ?? '',
    warehouseId: row?.warehouseId,
    limit: 50,
  });

  const cancelMutation = useCancelStockEvent();

  const handleCancel = async (eventId: string) => {
    try {
      await cancelMutation.mutateAsync(eventId);
      toast.success('재고 이벤트가 취소되었습니다.');
    } catch {
      toast.error('이벤트 취소에 실패했습니다.');
    }
  };

  // 서버는 occurredAt 오름차순으로 내려준다 — 최신 이벤트를 위로
  const items = history ? [...history].reverse() : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:w-[580px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            재고 이력 — {row?.skuName}
            {row?.warehouseName && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({row.warehouseName})
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4">
          {isLoading && (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          )}

          {!isLoading && items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              재고 이력이 없습니다.
            </p>
          )}

          {!isLoading && items.length > 0 && (
            <ul className="space-y-2">
              {items.map((item) => {
                const delta = deltaForWarehouse(item, row?.warehouseId);
                return (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-2 rounded-md border p-3 text-sm"
                  >
                    <div className="space-y-0.5">
                      <p className="font-medium">
                        {TRANSITION_TYPE_LABELS[item.transitionType] ??
                          item.transitionType}
                        <span
                          className={`ml-2 tabular-nums ${
                            delta > 0
                              ? 'text-green-600'
                              : delta < 0
                                ? 'text-red-600'
                                : 'text-muted-foreground'
                          }`}
                        >
                          {delta > 0 ? '+' : ''}
                          {(delta !== 0 ? delta : item.quantity).toLocaleString(
                            'ko-KR'
                          )}
                          {delta === 0 && ' (창고 내 전환)'}
                        </span>
                      </p>
                      {item.reason && (
                        <p className="text-xs text-muted-foreground">
                          {item.reason}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {new Date(item.occurredAt).toLocaleString('ko-KR')}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-xs"
                      disabled={cancelMutation.isPending}
                      onClick={() => handleCancel(item.id)}
                    >
                      취소
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
