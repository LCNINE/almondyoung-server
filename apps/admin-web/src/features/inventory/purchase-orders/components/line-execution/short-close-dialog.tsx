'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getServerDenyMessage } from '@/lib/api/server-error';
import { useShortClosePurchaseOrderLine } from '@/lib/services/inventory';
import type {
  PurchaseOrderDto,
  PurchaseOrderLineDto,
} from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  po: PurchaseOrderDto;
  line: PurchaseOrderLineDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ShortCloseLineDialog({ po, line, open, onOpenChange }: Props) {
  const [reason, setReason] = useState('');
  const mutation = useShortClosePurchaseOrderLine();

  useEffect(() => {
    if (open) setReason('');
  }, [open, line]);

  if (!line) return null;

  const handleSubmit = async () => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) return;
    try {
      await mutation.mutateAsync({
        poId: po.id,
        skuId: line.skuId,
        data: { reason: trimmedReason },
      });
      toast.success('남은 입고 수량을 포기했습니다.');
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(getServerDenyMessage(e, '잔량 포기에 실패했습니다.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>잔량 포기 — {line.sku?.name ?? line.skuId}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            남은 {line.outstandingQty}개를 더 받지 않고 종결합니다.{' '}
            <strong>되돌릴 수 없습니다.</strong>
          </p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="short-close-reason">사유 (필수, 500자 이내)</Label>
            <Textarea
              id="short-close-reason"
              maxLength={500}
              placeholder="공급처 품절 / 수량 조정 등"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={mutation.isPending || !reason.trim()}
          >
            {mutation.isPending ? '처리 중…' : '잔량 포기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
