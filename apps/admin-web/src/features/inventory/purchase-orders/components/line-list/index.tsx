'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  PurchaseOrderDto,
  PurchaseOrderLineDto,
  PurchaseOrderLineStatus,
} from '@/lib/types/dto/inventory';
import {
  isLineExecutable,
  sortLinesForExecution,
  toCalendarDate,
} from '../../line-execution-model';
import { OrderLineDialog } from '../line-execution/order-dialog';
import { MarkLineUnavailableDialog } from '../line-execution/unavailable-dialog';

const LINE_STATUS_LABELS: Record<PurchaseOrderLineStatus, string> = {
  requested: '요청됨',
  ordered: '발주됨',
  unavailable: '불가',
};

const LINE_STATUS_VARIANTS: Record<
  PurchaseOrderLineStatus,
  'outline' | 'secondary' | 'destructive'
> = {
  requested: 'outline',
  ordered: 'secondary',
  unavailable: 'destructive',
};

type LineAction = 'order' | 'unavailable';

export function PurchaseOrderLineList({ po }: { po: PurchaseOrderDto }) {
  const [activeLine, setActiveLine] = useState<PurchaseOrderLineDto | null>(null);
  const [activeAction, setActiveAction] = useState<LineAction | null>(null);

  const openAction = (line: PurchaseOrderLineDto, action: LineAction) => {
    setActiveLine(line);
    setActiveAction(action);
  };

  const closeAction = () => {
    setActiveLine(null);
    setActiveAction(null);
  };

  if (po.lines.length === 0) {
    return <p className="text-sm text-muted-foreground">라인 없음</p>;
  }

  return (
    <>
      <div className="space-y-2">
        {sortLinesForExecution(po.lines).map((line) => (
          <div key={line.skuId} className="rounded-md border p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{line.sku?.name ?? line.skuId}</span>
                  <Badge variant={LINE_STATUS_VARIANTS[line.status]} className="text-xs">
                    {LINE_STATUS_LABELS[line.status]}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
                  <span>
                    요청 {line.quantity}
                    {line.orderedQty != null && ` → 실발주 ${line.orderedQty}`}
                  </span>
                  {line.unitPrice != null && (
                    <span>단가 {line.unitPrice.toLocaleString('ko-KR')}원</span>
                  )}
                  {line.expectedArrival && <span>도착예정 {toCalendarDate(line.expectedArrival)}</span>}
                </div>

                {line.unavailableReason && (
                  <span className="text-xs text-destructive">사유: {line.unavailableReason}</span>
                )}
                {line.orderedAt && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(line.orderedAt).toLocaleString('ko-KR')}
                    {line.orderedBy && ` · ${line.orderedBy}`}
                  </span>
                )}
              </div>

              {isLineExecutable(po.status, line) && (
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="outline" onClick={() => openAction(line, 'order')}>
                    실행
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openAction(line, 'unavailable')}>
                    불가
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <OrderLineDialog
        po={po}
        line={activeLine}
        open={activeAction === 'order'}
        onOpenChange={(o) => {
          if (!o) closeAction();
        }}
      />
      <MarkLineUnavailableDialog
        po={po}
        line={activeLine}
        open={activeAction === 'unavailable'}
        onOpenChange={(o) => {
          if (!o) closeAction();
        }}
      />
    </>
  );
}
