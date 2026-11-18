'use client';

import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useUnshippedOrders } from '@/lib/services/inventory';
import type {
  StockSummaryGroupSkuDto,
  UnshippedOrderProgress,
} from '@/lib/types/dto/inventory';
import { cn } from '@/lib/utils';

const PROGRESS_LABELS: Record<UnshippedOrderProgress, string> = {
  not_boxed: '상자 생성 전',
  waiting: '검수 대기',
  inspecting: '검수 중',
  inspected: '검수 완료',
  recovery_required: '복구 필요',
};

const KST_DAY = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
});

type ShipFilter = 'all' | 'can_ship' | 'short';

type Props = {
  row: StockSummaryGroupSkuDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function UnshippedOrdersDrawer({ row, open, onOpenChange }: Props) {
  const { data, isLoading } = useUnshippedOrders(
    row?.skuId ?? '',
    row?.warehouseId ?? ''
  );
  const [filter, setFilter] = useState<ShipFilter>('all');

  const items = data?.items ?? [];
  const canShipCount = items.filter((item) => item.canShip).length;
  const visible = items.filter((item) => {
    if (filter === 'can_ship') return item.canShip;
    if (filter === 'short') return !item.canShip;

    return true;
  });

  const cards = [
    { label: '재고', value: row?.currentQuantity ?? 0 },
    { label: '미발송', value: row?.unshippedQuantity ?? 0 },
    {
      label: '만들어야 할 수량',
      value: row?.shortageQuantity ?? 0,
      strong: true,
    },
    { label: '안정재고', value: row?.safetyStock ?? '-' },
  ];
  const filters: { value: ShipFilter; label: string }[] = [
    { value: 'all', label: `전체 ${items.length}` },
    { value: 'can_ship', label: `출고 가능 ${canShipCount}` },
    { value: 'short', label: `재고 부족 ${items.length - canShipCount}` },
  ];

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setFilter('all');
        onOpenChange(next);
      }}
    >
      <SheetContent className="w-[560px] overflow-y-auto sm:w-[640px] sm:max-w-none">
        <SheetHeader>
          <span className="text-xs text-muted-foreground">
            미발송 내역 · {row?.warehouseName}
          </span>
          <SheetTitle>{row?.skuName}</SheetTitle>
          <span className="text-xs text-muted-foreground">
            {row?.skuCode}
            {row?.shelfPosition && ` · ${row.shelfPosition}`}
          </span>
        </SheetHeader>

        <div className="mt-4 grid grid-cols-4 gap-2">
          {cards.map((card) => (
            <div
              key={card.label}
              className={cn(
                'rounded-md border px-3 py-2',
                card.strong && 'border-foreground'
              )}
            >
              <div
                className={cn(
                  'text-xs text-muted-foreground',
                  card.strong && 'font-semibold text-foreground'
                )}
              >
                {card.label}
              </div>
              <div className="text-xl font-bold tabular-nums">{card.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-1.5">
          {filters.map((item) => (
            <Button
              key={item.value}
              type="button"
              size="sm"
              variant={filter === item.value ? 'default' : 'outline'}
              className="h-7 rounded-full text-xs"
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-2 py-2 font-medium">주문일</th>
                <th className="px-2 py-2 font-medium">주문번호</th>
                <th className="px-2 py-2 font-medium">주문자</th>
                <th className="px-2 py-2 font-medium">진행</th>
                <th className="px-2 py-2 font-medium">출고</th>
                <th className="px-2 py-2 text-right font-medium">수량</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-2 py-8 text-center text-muted-foreground"
                  >
                    불러오는 중…
                  </td>
                </tr>
              )}
              {!isLoading && visible.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-2 py-8 text-center text-muted-foreground"
                  >
                    미발송 주문이 없습니다.
                  </td>
                </tr>
              )}
              {visible.map((item) => (
                <tr
                  key={item.fulfillmentOrderItemId}
                  className={cn('border-b', !item.canShip && 'bg-muted/30')}
                >
                  <td className="whitespace-nowrap px-2 py-2">
                    {KST_DAY.format(new Date(item.orderedAt))}
                    {item.delayDays > 0 && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({item.delayDays}일 지연)
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">
                    {item.orderNo ?? '-'}
                    {item.channelName && (
                      <div className="text-xs text-muted-foreground">
                        {item.channelName}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">{item.customerName ?? '-'}</td>
                  <td className="whitespace-nowrap px-2 py-2">
                    {PROGRESS_LABELS[item.progress]}
                  </td>
                  <td
                    className={cn(
                      'whitespace-nowrap px-2 py-2',
                      item.canShip ? 'font-semibold' : 'font-bold'
                    )}
                  >
                    {item.canShip ? '출고 가능' : '재고 부족'}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {item.remainingQuantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          주문일이 빠른 순서입니다. 재고 부족은 아직 재고가 잡히지 않은
          주문입니다.
        </p>
      </SheetContent>
    </Sheet>
  );
}
