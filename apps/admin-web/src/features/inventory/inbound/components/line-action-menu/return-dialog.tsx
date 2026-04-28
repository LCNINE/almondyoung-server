'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useReturnInbound } from '@/lib/services/inventory';
import type { InboundReceiptLineDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  line: InboundReceiptLineDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ReturnDialog({ line, open, onOpenChange }: Props) {
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const mutation = useReturnInbound();

  const availableQty = line ? line.quantity - line.returnedQty - line.canceledQty : 0;
  const blockedByPutaway = line ? line.putawayFromOriginQty > 0 : false;

  const handleSubmit = async () => {
    if (!line) return;
    try {
      await mutation.mutateAsync({ lineId: line.id, quantity, reason: reason.trim() || undefined });
      toast.success('회송이 처리되었습니다.');
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '회송 처리에 실패했습니다.');
    }
  };

  if (!line) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>회송 처리</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          {blockedByPutaway && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              이미 적치된 수량이 있어 회송할 수 없습니다. 적치를 먼저 되돌려 주세요.
            </p>
          )}
          <div className="text-sm text-muted-foreground">
            회송 가능 수량: <span className="font-medium text-foreground">{availableQty}</span>
          </div>
          <div className="flex flex-col gap-1">
            <Label>수량</Label>
            <Input
              type="number"
              min={1}
              max={availableQty}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              disabled={blockedByPutaway}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>회송 사유 (선택)</Label>
            <Input
              placeholder="사유"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={blockedByPutaway}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending || blockedByPutaway}
          >
            {mutation.isPending ? '처리 중…' : '회송'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
