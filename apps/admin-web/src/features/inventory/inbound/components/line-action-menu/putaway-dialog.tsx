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
import { usePutaway } from '@/lib/services/inventory';
import type { InboundReceiptLineDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  line: InboundReceiptLineDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PutawayDialog({ line, open, onOpenChange }: Props) {
  const [toLocationId, setToLocationId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const mutation = usePutaway();

  const availableQty =
    line ? line.quantity - line.returnedQty - line.canceledQty - line.putawayFromOriginQty : 0;

  const handleSubmit = async () => {
    if (!line) return;
    if (!toLocationId.trim()) {
      toast.error('목적지 로케이션 ID를 입력해 주세요.');
      return;
    }
    try {
      await mutation.mutateAsync({ lineId: line.id, toLocationId: toLocationId.trim(), quantity });
      toast.success('적치가 처리되었습니다.');
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '적치 처리에 실패했습니다.');
    }
  };

  if (!line) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>적치 처리</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="text-sm text-muted-foreground">
            가용 수량: <span className="font-medium text-foreground">{availableQty}</span>
          </div>
          <div className="flex flex-col gap-1">
            <Label>목적지 로케이션 ID</Label>
            <Input
              placeholder="로케이션 ID 입력"
              value={toLocationId}
              onChange={(e) => setToLocationId(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>수량</Label>
            <Input
              type="number"
              min={1}
              max={availableQty}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? '처리 중…' : '적치'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
