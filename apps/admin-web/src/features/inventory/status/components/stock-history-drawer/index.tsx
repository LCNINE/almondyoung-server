'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useStockHistory, useCancelStockEvent } from '@/lib/services/inventory';
import type { StockSummaryDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  row: StockSummaryDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  IN: '입고',
  OUT: '출고',
  ADJUST: '조정',
  MOVE: '이동',
  RESERVE: '예약',
  CONFIRM: '확정',
  RELEASE: '예약 해제',
  CANCEL: '취소',
};

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

          {!isLoading && (!history || history.length === 0) && (
            <p className="text-sm text-muted-foreground">재고 이력이 없습니다.</p>
          )}

          {!isLoading && history && history.length > 0 && (
            <ul className="space-y-2">
              {history.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <div className="space-y-0.5">
                    <p className="font-medium">
                      {EVENT_TYPE_LABELS[item.eventType] ?? item.eventType}
                      <span
                        className={`ml-2 tabular-nums ${
                          item.deltaQuantity > 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {item.deltaQuantity > 0 ? '+' : ''}
                        {item.deltaQuantity.toLocaleString('ko-KR')}
                      </span>
                    </p>
                    {item.reason && (
                      <p className="text-xs text-muted-foreground">{item.reason}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.eventTimestamp).toLocaleString('ko-KR')}
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
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
