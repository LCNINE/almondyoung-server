'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCancelInbound, useCancelPurchaseOrderReceiptLine } from '@/lib/services/inventory';
import type { InboundReceiptLineDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';
import {
  INBOUND_SHIPMENT_CANCEL_NOTICE,
  receiptLineCancelRoute,
} from '../../lib/receipt-line-cancel';

type Props = {
  line: InboundReceiptLineDto | null;
  source: InboundReceiptLineDto['source'] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CancelDialog({ line, source, open, onOpenChange }: Props) {
  const directMutation = useCancelInbound();
  const purchaseOrderMutation = useCancelPurchaseOrderReceiptLine();
  const isPending = directMutation.isPending || purchaseOrderMutation.isPending;

  const route = receiptLineCancelRoute(source);
  const blockedByAction = line
    ? line.putawayFromOriginQty > 0 || line.returnedQty > 0
    : false;

  const handleSubmit = async () => {
    if (!line || route === 'inbound_shipment') return;
    try {
      if (route === 'purchase_order') {
        await purchaseOrderMutation.mutateAsync({ receiptLineId: line.id });
      } else {
        await directMutation.mutateAsync({ lineId: line.id, quantity: line.quantity });
      }
      toast.success('입고가 취소되었습니다.');
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '입고 취소에 실패했습니다.');
    }
  };

  if (!line) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>입고 취소</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          {blockedByAction && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              적치 또는 회송 이력이 있어 취소할 수 없습니다.
            </p>
          )}
          {route === 'purchase_order' && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">발주 입고입니다. 발주 수령을 취소합니다.</p>
          )}
          {route === 'inbound_shipment' && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">{INBOUND_SHIPMENT_CANCEL_NOTICE}</p>
          )}
          <p className="text-sm text-muted-foreground">
            취소는 <strong>당일</strong> 내, <strong>전체 수량({line.quantity}개)</strong>만 가능합니다.
            적치·회송 이력이 없어야 합니다.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={isPending || blockedByAction || route === 'inbound_shipment'}
          >
            {isPending ? '처리 중…' : '취소 확인'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
