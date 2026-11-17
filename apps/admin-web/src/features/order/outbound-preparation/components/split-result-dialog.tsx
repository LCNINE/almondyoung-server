'use client';

import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRunOutboundPreparation } from '@/lib/services/orders';
import type { PreparationShipmentDto } from '@/lib/types/dto/fulfillment';
import { plannedOrderText, splitQuantities } from '../preparation-model';

export function SplitResultDialog({
  shipments,
  failedCount,
  canPrepare,
  onPrepare,
  onShowWaiting,
  onClose,
}: {
  shipments: PreparationShipmentDto[];
  failedCount: number;
  canPrepare: boolean;
  onPrepare: () => void;
  onShowWaiting: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {shipments.length > 0
              ? `${shipments.length}건을 나눴어요`
              : '상자를 나누지 못했어요'}
          </DialogTitle>
          <DialogDescription>
            {shipments.length > 0
              ? '예약된 수량은 원래 상자에 남아 지금 보낼 수 있고, 모자란 수량은 출고불가 상자로 옮겼어요.'
              : '부분출고 내역에 그대로 남아 있어요.'}
          </DialogDescription>
        </DialogHeader>
        {shipments.length > 0 && (
          <ul
            role="list"
            className="max-h-60 space-y-1 overflow-y-auto text-sm"
          >
            {shipments.map((shipment) => {
              const split = shipment.lines?.length
                ? splitQuantities(shipment.lines)
                : null;

              return (
                <li
                  key={shipment.shipmentId}
                  className="flex justify-between gap-3"
                >
                  <span>{plannedOrderText(shipment)}</span>
                  {split && (
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      지금 보낼 {split.now} · 기다릴 {split.wait}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {failedCount > 0 && (
          <p className="text-sm font-semibold text-foreground">
            {failedCount}건은 나누지 못했어요
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
          {shipments.length > 0 && (
            <>
              <Button variant="outline" onClick={onShowWaiting}>
                기다릴 상자 보기
              </Button>
              <Can run={useRunOutboundPreparation}>
                <Button disabled={!canPrepare} onClick={onPrepare}>
                  지금 보낼 상자 출고 준비
                </Button>
              </Can>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
